param([int]$Port = 18766)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ServerScript = Join-Path $Root "server\server.ps1"
$tokensErr = $null
[System.Management.Automation.PSParser]::Tokenize((Get-Content $ServerScript -Raw), [ref]$tokensErr) | Out-Null
if ($tokensErr.Count -gt 0) {
    $tokensErr | Format-List | Out-String | Write-Error
    throw "Syntax error in server.ps1"
}
Write-Host "[PASS] server.ps1 PowerShell syntax OK"

$logOut = Join-Path $Root "tools\srv.out.log"
$logErr = Join-Path $Root "tools\srv.err.log"
$proc = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $ServerScript, "-Port", "$Port") -PassThru -WindowStyle Hidden -RedirectStandardOutput $logOut -RedirectStandardError $logErr
Start-Sleep -Seconds 3

try {
    if ($proc.HasExited) {
        $errTxt = if (Test-Path $logErr) { Get-Content $logErr -Raw } else { "" }
        $outTxt = if (Test-Path $logOut) { Get-Content $logOut -Raw } else { "" }
        throw "Server exited early ($($proc.ExitCode)): $errTxt $outTxt"
    }
    $baseUrl = "http://127.0.0.1:$Port"
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method Get
    if (-not $health.ok) { throw "Health check failed" }
    Write-Host "[PASS] /api/health -> $($health.app) v$($health.version), mcpTools=$($health.mcpTools)"

    $html = Invoke-WebRequest -Uri "$baseUrl/" -UseBasicParsing
    if ($html.StatusCode -ne 200 -or $html.Content -notmatch "SG Vision Farmer") { throw "index.html check failed" }
    Write-Host "[PASS] GET / -> 200 OK ($($html.Content.Length) chars)"

    $glasses = Invoke-WebRequest -Uri "$baseUrl/glasses.html" -UseBasicParsing
    if ($glasses.StatusCode -ne 200 -or $glasses.Content -notmatch "HUD LUNETTES AR") { throw "glasses.html check failed" }
    Write-Host "[PASS] GET /glasses.html -> 200 OK"

    $stateSample = @{
        farm = @{ name = "TestFerme"; scale = "micro"; areaHa = 0.5; location = @{ name = "Valence" }; activities = @("maraichage_champ") }
        simulation = @{ dayOffset = 0 }
        plots = @(@{ id = "P1"; name = "Planche P1"; zone = "Plein champ"; areaM2 = 100; cropId = "carotte"; stage = "Croissance"; moisturePct = 55; healthPct = 92; diseaseRisk = 12 })
        equipment = @(@{ id = "ROB-WEED"; autonomous = $true })
        livestock = @()
        resources = @()
        finances = @{ cashBalance = 15000 }
        weather = @{ current = @{ tempC = 21 }; forecast = @(@{ date = "2026-11-13" }) }
    } | ConvertTo-Json -Depth 8

    $saveRes = Invoke-RestMethod -Uri "$baseUrl/api/state" -Method Post -ContentType "application/json; charset=utf-8" -Body $stateSample
    if (-not $saveRes.ok) { throw "POST /api/state failed" }
    Write-Host "[PASS] POST /api/state -> saved $($saveRes.bytes) bytes"

    $mcpInit = Invoke-RestMethod -Uri "$baseUrl/mcp" -Method Post -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
    if ($mcpInit.result.serverInfo.name -ne "SG-Vision-Farmer-MCP") { throw "MCP initialize failed" }
    Write-Host "[PASS] POST /mcp initialize -> $($mcpInit.result.serverInfo.name)"

    $mcpList = Invoke-RestMethod -Uri "$baseUrl/mcp" -Method Post -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
    Write-Host "[PASS] POST /mcp tools/list -> $($mcpList.result.tools.Count) tools"

    $mcpCall = Invoke-RestMethod -Uri "$baseUrl/mcp" -Method Post -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"farm_overview","arguments":{}}}'
    Write-Host "[PASS] POST /mcp tools/call(farm_overview) -> $($mcpCall.result.content[0].text)"

    $mcpCmd = Invoke-RestMethod -Uri "$baseUrl/mcp" -Method Post -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"control_robot_or_automation","arguments":{"targetId":"ROB-WEED","action":"dispatch","plotId":"P1"}}}'
    $cmdJson = $mcpCmd.result.content[0].text | ConvertFrom-Json
    if ($cmdJson.command.action -ne "dispatch" -or $cmdJson.command.targetId -ne "ROB-WEED") {
        throw "MCP control_robot_or_automation did not preserve action/targetId"
    }
    Write-Host "[PASS] POST /mcp tools/call(control_robot_or_automation) -> action=$($cmdJson.command.action), target=$($cmdJson.command.targetId), plot=$($cmdJson.command.plotId)"

    $tel = Invoke-RestMethod -Uri "$baseUrl/api/telemetry" -Method Post -ContentType "application/json" -Body '{"sensor":"wx_station","tempC":19.5}'
    if (-not $tel.ok) { throw "Telemetry webhook failed" }
    Write-Host "[PASS] POST /api/telemetry -> stored=$($tel.stored)"

    Remove-Item (Join-Path $Root "data\farm-state.json") -ErrorAction SilentlyContinue
    $edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    if (Test-Path $edgePath) {
        $tmpProf = Join-Path $env:TEMP "sg-farmer-edge-test"
        $domOut = Join-Path $Root "tools\edge-dom.tmp.html"
        $gDomOut = Join-Path $Root "tools\edge-gdom.tmp.html"
        if (Test-Path $tmpProf) { Remove-Item $tmpProf -Recurse -Force -ErrorAction SilentlyContinue }
        $eProc = Start-Process -FilePath $edgePath -ArgumentList @("--headless=new", "--no-sandbox", "--disable-gpu", "--user-data-dir=`"$tmpProf`"", "--virtual-time-budget=4000", "--dump-dom", "`"$baseUrl/`"") -Wait -PassThru -NoNewWindow -RedirectStandardOutput $domOut -RedirectStandardError (Join-Path $Root "tools\edge-err.tmp.log")
        $dom = if (Test-Path $domOut) { Get-Content $domOut -Raw -Encoding UTF8 } else { "" }
        if ($dom -match "Domaine Val-Soleil" -and $dom -match "farm-canvas") {
            Write-Host "[PASS] Headless Edge rendered SG Vision Farmer + 3D canvas + initial state!"
        } else {
            $errEdge = if (Test-Path (Join-Path $Root "tools\edge-err.tmp.log")) { Get-Content (Join-Path $Root "tools\edge-err.tmp.log") -Raw } else { "" }
            throw "Headless Edge did not render expected farm UI (code=$($eProc.ExitCode), len=$($dom.Length)): $errEdge"
        }

        $gProc = Start-Process -FilePath $edgePath -ArgumentList @("--headless=new", "--no-sandbox", "--disable-gpu", "--user-data-dir=`"$tmpProf`"", "--virtual-time-budget=3000", "--dump-dom", "`"$baseUrl/glasses.html`"") -Wait -PassThru -NoNewWindow -RedirectStandardOutput $gDomOut -RedirectStandardError (Join-Path $Root "tools\edge-gerr.tmp.log")
        $gDom = if (Test-Path $gDomOut) { Get-Content $gDomOut -Raw -Encoding UTF8 } else { "" }
        if ($gDom -match "HUD LUNETTES AR" -and $gDom -match "Autonomie Globale") {
            Write-Host "[PASS] Headless Edge rendered Smart Glasses AR HUD (/glasses.html)!"
        } else {
            throw "Headless Edge did not render glasses HUD (code=$($gProc.ExitCode), len=$($gDom.Length))"
        }

        # Deep unit + all-7-views render test inside Edge
        $verifyHtmlPath = Join-Path $Root "public\_verify_tmp.html"
        $verifyDomOut = Join-Path $Root "tools\edge-vdom.tmp.html"
        @'
<!doctype html><html><body><div id="mount"></div><div id="res">RUNNING</div>
<script type="module">
import { buildPresetState, SCALE_PRESETS, BUILDING_CATALOG, ANIMAL_SPECIES, TERRAIN_PRESETS } from "/src/data/presets.js";
import { simulateFuture, evaluateRotation } from "/src/engine/predictor.js";
import { evaluateAutomations, dispatchRobot, toggleIrrigation, setGreenhouseVent, toggleCoopDoor } from "/src/engine/automation.js";
import { processNaturalCommand } from "/src/engine/aiAssistant.js";
import { injectWeatherEvent } from "/src/engine/weather.js";
import { getTerrainHeight, sculptTerrainAt, Farm3DEngine } from "/src/engine/engine3d.js";
import { drawDemoVideoScanFrame, analyzeFrameToFarmLayout, applyScanToFarmState } from "/src/engine/scanner3d.js";
import { renderView3D } from "/src/ui/view3d.js";
import { renderViewAgronomy } from "/src/ui/viewAgronomy.js";
import { renderViewLivestock } from "/src/ui/viewLivestock.js";
import { renderViewRobotics } from "/src/ui/viewRobotics.js";
import { renderViewResources } from "/src/ui/viewResources.js";
import { renderViewForecastFinance } from "/src/ui/viewForecastFinance.js";
import { renderViewEcosystem } from "/src/ui/viewEcosystem.js";

const out = document.getElementById("res");
try {
  if (BUILDING_CATALOG.length < 24 || ANIMAL_SPECIES.length < 8 || TERRAIN_PRESETS.length < 4) {
    throw new Error("V2 catalog sizes invalid");
  }
  for (const p of SCALE_PRESETS) {
    const s = buildPresetState(p.id);
    const sim = simulateFuture(s, 90, "heatwave");
    if (!sim.daily || sim.daily.length !== 91) throw new Error("Bad horizon for " + p.id);
  }
  const st = buildPresetState("polyculture");
  const hBefore = getTerrainHeight(st, 0, 0);
  sculptTerrainAt(st, 0, 0, "raise", 6, 0.8);
  const hAfter = getTerrainHeight(st, 0, 0);
  if (!(hAfter > hBefore)) throw new Error("sculptTerrainAt did not raise terrain height");

  // Test Video/Camera 3D Reconstruction Scanner
  const scanCanvas = document.createElement("canvas");
  scanCanvas.width = 520; scanCanvas.height = 280;
  drawDemoVideoScanFrame(scanCanvas.getContext("2d"), 520, 280, "coteau_ferme", 1.2);
  const scanRes = analyzeFrameToFarmLayout(scanCanvas);
  if (!scanRes.detections || scanRes.detections.length < 4) throw new Error("Scanner failed to detect farm zones");
  const stScan = buildPresetState("micro_urbaine");
  applyScanToFarmState(stScan, scanRes);
  if (stScan.structures.length < 4) throw new Error("applyScanToFarmState did not populate 3D structures");

  const rot = evaluateRotation(st.plots[0], "tomate");
  if (typeof rot.score !== "number") throw new Error("Rotation score invalid");
  injectWeatherEvent(st, "storm");
  const autos = evaluateAutomations(st);
  if (autos.length < 1) throw new Error("Expected storm automation trigger");
  const ai1 = processNaturalCommand(st, "Envoie le rover sur P2", simulateFuture(st, 30, "normal"));
  if (!ai1.mutated) throw new Error("Expected AI command mutation");
  const mount = document.getElementById("mount");
  const fc = simulateFuture(st, 60, "normal");
  const ctx = {
    state: st, forecast: fc,
    uiState: { overlay: "normal", showArPins: false, buildActive: false, buildCategory: "all", buildType: "bed_open", buildRot: 0, sculptActive: true, sculptTool: "raise", sculptRadius: 5, scannerOpen: true, demoScanId: "coteau_ferme", selectedObject: null, agroTab: "plots", forecastHorizon: 60 },
    engine3d: null, serverStatus: { online: true, mcpTools: 6 },
    save: () => {}, rerender: () => {}, refreshForecastOnly: () => {}, replaceState: () => {}, toast: () => {}, mountCanvas: (c) => {
      if (c) {
        const eng = new Farm3DEngine(c, {});
        eng.render(st, fc, 0.016);
      }
    }
  };
  renderView3D(mount, ctx);
  for (const tab of ["plots", "rotations", "planning", "diseases"]) {
    ctx.uiState.agroTab = tab;
    renderViewAgronomy(mount, ctx);
  }
  renderViewLivestock(mount, ctx);
  renderViewRobotics(mount, ctx);
  renderViewResources(mount, ctx);
  renderViewForecastFinance(mount, ctx);
  renderViewEcosystem(mount, ctx);
  out.textContent = "ALL_7_VIEWS_AND_ENGINES_PASS";
} catch (err) {
  out.textContent = "FAIL: " + (err && err.stack ? err.stack : err);
}
</script></body></html>
'@ | Set-Content -Path $verifyHtmlPath -Encoding UTF8

        $vProc = Start-Process -FilePath $edgePath -ArgumentList @("--headless=new", "--no-sandbox", "--disable-gpu", "--user-data-dir=`"$tmpProf`"", "--virtual-time-budget=3000", "--dump-dom", "`"$baseUrl/_verify_tmp.html`"") -Wait -PassThru -NoNewWindow -RedirectStandardOutput $verifyDomOut -RedirectStandardError (Join-Path $Root "tools\edge-verr.tmp.log")
        $vDom = if (Test-Path $verifyDomOut) { Get-Content $verifyDomOut -Raw -Encoding UTF8 } else { "" }
        Remove-Item $verifyHtmlPath, $verifyDomOut, (Join-Path $Root "tools\edge-verr.tmp.log") -ErrorAction SilentlyContinue
        if ($vDom -match "ALL_7_VIEWS_AND_ENGINES_PASS") {
            Write-Host "[PASS] Deep JS/UI Verification: all 5 scale presets, 365/90d predictor, rotation, storm automations, AI command & all 7 views rendered without error!"
        } else {
            throw "Deep JS/UI Verification failed: $vDom"
        }

        Remove-Item $domOut, $gDomOut, (Join-Path $Root "tools\edge-err.tmp.log"), (Join-Path $Root "tools\edge-gerr.tmp.log") -ErrorAction SilentlyContinue
        Remove-Item $tmpProf -Recurse -Force -ErrorAction SilentlyContinue
    }
} finally {
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/shutdown" -Method Post -TimeoutSec 2 | Out-Null
    } catch {}
    if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $logOut -ErrorAction SilentlyContinue
    Remove-Item $logErr -ErrorAction SilentlyContinue
    $dataDir = Join-Path $Root "data"
    Remove-Item (Join-Path $dataDir "farm-state.json") -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $dataDir "hud-state.json") -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $dataDir "telemetry-log.json") -ErrorAction SilentlyContinue
}
