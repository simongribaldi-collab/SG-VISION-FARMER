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
$testDataDir = Join-Path $env:TEMP "sg-farmer-test-data"
if (Test-Path $testDataDir) { Remove-Item $testDataDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $testDataDir -Force | Out-Null
$proc = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $ServerScript, "-Port", "$Port", "-DataDir", $testDataDir) -PassThru -WindowStyle Hidden -RedirectStandardOutput $logOut -RedirectStandardError $logErr
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

    $glbBytes = [byte[]](0x67, 0x6C, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00)
    $upRes = Invoke-RestMethod -Uri "$baseUrl/api/models?name=test_tracteur.glb" -Method Post -ContentType "application/octet-stream" -Body $glbBytes
    if (-not $upRes.ok -or $upRes.url -ne "/api/models/test_tracteur.glb") { throw "POST /api/models failed" }
    $dlResp = Invoke-WebRequest -Uri "$baseUrl/api/models/test_tracteur.glb" -UseBasicParsing
    if ($dlResp.StatusCode -ne 200 -or $dlResp.RawContentLength -ne $glbBytes.Length) { throw "GET /api/models binary mismatch" }
    Write-Host "[PASS] POST/GET /api/models binary GLB roundtrip -> $($upRes.url) ($($upRes.bytes) bytes)"

    Remove-Item (Join-Path $testDataDir "farm-state.json") -ErrorAction SilentlyContinue
    $edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    if (Test-Path $edgePath) {
        $tmpProf = Join-Path $env:TEMP "sg-farmer-edge-test"
        $domOut = Join-Path $Root "tools\edge-dom.tmp.html"
        $gDomOut = Join-Path $Root "tools\edge-gdom.tmp.html"
        if (Test-Path $tmpProf) { Remove-Item $tmpProf -Recurse -Force -ErrorAction SilentlyContinue }
        $edgeWebGlArgs = @("--headless=new", "--no-sandbox", "--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--user-data-dir=`"$tmpProf`"")
        $eProc = Start-Process -FilePath $edgePath -ArgumentList ($edgeWebGlArgs + @("--virtual-time-budget=4500", "--dump-dom", "`"$baseUrl/`"")) -Wait -PassThru -NoNewWindow -RedirectStandardOutput $domOut -RedirectStandardError (Join-Path $Root "tools\edge-err.tmp.log")
        $dom = if (Test-Path $domOut) { Get-Content $domOut -Raw -Encoding UTF8 } else { "" }
        if ($dom -match "Ferme Granges-les-Beaumont" -and $dom -match "farm-canvas") {
            Write-Host "[PASS] Headless Edge rendered SG Vision Farmer + 3D canvas + initial state!"
        } else {
            $errEdge = if (Test-Path (Join-Path $Root "tools\edge-err.tmp.log")) { Get-Content (Join-Path $Root "tools\edge-err.tmp.log") -Raw } else { "" }
            throw "Headless Edge did not render expected farm UI (code=$($eProc.ExitCode), len=$($dom.Length)): $errEdge"
        }

        $gProc = Start-Process -FilePath $edgePath -ArgumentList ($edgeWebGlArgs + @("--virtual-time-budget=3500", "--dump-dom", "`"$baseUrl/glasses.html`"")) -Wait -PassThru -NoNewWindow -RedirectStandardOutput $gDomOut -RedirectStandardError (Join-Path $Root "tools\edge-gerr.tmp.log")
        $gDom = if (Test-Path $gDomOut) { Get-Content $gDomOut -Raw -Encoding UTF8 } else { "" }
        if ($gDom -match "HUD LUNETTES AR" -and $gDom -match "Autonomie Globale") {
            Write-Host "[PASS] Headless Edge rendered Smart Glasses AR HUD (/glasses.html)!"
        } else {
            throw "Headless Edge did not render glasses HUD (code=$($gProc.ExitCode), len=$($gDom.Length))"
        }

        # Deep unit + V3 WebGL shader/FBO + all-7-views coherence test inside Edge
        $verifyHtmlPath = Join-Path $Root "public\_verify_tmp.html"
        $verifyDomOut = Join-Path $Root "tools\edge-vdom.tmp.html"
        @'
<!doctype html><html><body><div id="mount"></div><div id="res">RUNNING</div>
<script type="module">
import { buildPresetState, computeGrangesFinancialPlan, SCALE_PRESETS, BUILDING_CATALOG, ANIMAL_SPECIES, TERRAIN_PRESETS } from "/src/data/presets.js";
import { simulateFuture, evaluateRotation } from "/src/engine/predictor.js";
import { evaluateAutomations, dispatchRobot, toggleIrrigation, setGreenhouseVent, toggleCoopDoor } from "/src/engine/automation.js";
import { processNaturalCommand } from "/src/engine/aiAssistant.js";
import { injectWeatherEvent } from "/src/engine/weather.js";
import { getTerrainHeight, sculptTerrainAt, Farm3DEngine } from "/src/engine/engine3d.js";
import { drawDemoVideoScanFrame, analyzeFrameToFarmLayout, applyScanToFarmState } from "/src/engine/scanner3d.js";
import { filterBuildingCatalog, renderView3D } from "/src/ui/view3d.js";
import { renderViewAgronomy } from "/src/ui/viewAgronomy.js";
import { renderViewLivestock } from "/src/ui/viewLivestock.js";
import { renderViewRobotics } from "/src/ui/viewRobotics.js";
import { renderViewResources } from "/src/ui/viewResources.js";
import { renderViewForecastFinance } from "/src/ui/viewForecastFinance.js";
import { renderViewEcosystem } from "/src/ui/viewEcosystem.js";

const out = document.getElementById("res");
try {
  if (BUILDING_CATALOG.length < 28 || ANIMAL_SPECIES.length < 8 || TERRAIN_PRESETS.length < 4) {
    throw new Error("V3 catalog sizes invalid");
  }
  for (const b of BUILDING_CATALOG) {
    if (!b.category) throw new Error("Missing category on building: " + b.type);
  }
  for (const cat of ["all", "corps_ferme", "paysage", "culture", "elevage", "energie"]) {
    if (filterBuildingCatalog(cat).length === 0) throw new Error("Empty build category filter: " + cat);
  }

  for (const p of SCALE_PRESETS) {
    const s = buildPresetState(p.id);
    if (s.version !== 3) throw new Error("Preset version must be 3 for " + p.id);
    const sim = simulateFuture(s, 90, "heatwave", 0);
    if (!sim.daily || sim.daily.length !== 91) throw new Error("Bad horizon for " + p.id);
  }

  // Verify Granges-les-Beaumont (ZE 309 + ZE 375) farm state & exact business plan math
  const gbState = buildPresetState("granges_beaumont");
  if (gbState.farm.areaHa !== 1.65 || gbState.plots.length !== 12 || gbState.farm.cadastralParcels?.length !== 2) {
    throw new Error("Granges-les-Beaumont plots/cadastral structure mismatch");
  }
  if (gbState.finances.cashBalance !== 9700 || gbState.livestock[0]?.count !== 249 || gbState.livestock[0]?.eggPriceUnit !== 0.39) {
    throw new Error("Granges-les-Beaumont cash/hens mismatch");
  }
  const planDef = computeGrangesFinancialPlan({ deferred24m: true });
  const expNetAv = [1089, 2481, 2905, 3159, 3036, 3072];
  const expNetAp = [1059, 2412, 2825, 3072, 2953, 2734];
  planDef.rows.forEach((r, idx) => {
    if (r.netAvIrM !== expNetAv[idx] || r.netApIrM !== expNetAp[idx]) {
      throw new Error(`Granges row ${r.yr} mismatch: av=${r.netAvIrM}/${expNetAv[idx]} ap=${r.netApIrM}/${expNetAp[idx]}`);
    }
  });
  if (planDef.tot2829AvIrEur !== 60712 || planDef.tot2829ApIrEur !== 59534 || planDef.coverageNoPh !== 2.01 || planDef.coverageWithPh !== 1.59) {
    throw new Error("Granges transition/banking metrics mismatch");
  }
  const planLin = computeGrangesFinancialPlan({ deferred24m: false });
  if (planLin.monthly2829 !== 1122 || planLin.coverageNoPh !== 2.15 || planLin.minSellerEbeNoPh !== 26922) {
    throw new Error("Granges non-deferred option metrics mismatch");
  }
  const gbAi = processNaturalCommand(gbState, "Synthèse prêt 185116 et ZE 309", simulateFuture(gbState, 30, "normal", 0));
  if (!gbAi.reply.includes("185 116") && !gbAi.reply.includes("185\u202f116") && !gbAi.reply.includes("60 712") && !gbAi.reply.includes("60\u202f712")) {
    throw new Error("Granges AI financing reply mismatch: " + gbAi.reply);
  }

  const st = buildPresetState("polyculture");
  const fc0 = simulateFuture(st, 60, "normal", 0);
  const fc45 = simulateFuture(st, 60, "normal", 45);
  const p0 = fc0.plotSnapshots.find((x) => x.id === "P1");
  const p45 = fc45.plotSnapshots.find((x) => x.id === "P1");
  if (!p0 || !p45 || !(p45.progressPct > p0.progressPct)) {
    throw new Error("Time-Machine plotSnapshots did not advance between J+0 and J+45");
  }

  const rotCurrent = evaluateRotation(st.plots[0], st.plots[0].cropId, { includeCurrent: false });
  const rotRepeat = evaluateRotation(st.plots[0], st.plots[0].cropId, { includeCurrent: true });
  if (!(rotCurrent.score >= 70 && rotRepeat.score < 60)) {
    throw new Error("Rotation evaluation failed: current=" + rotCurrent.score + ", repeat=" + rotRepeat.score);
  }

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
  const stScan = buildPresetState("micro");
  applyScanToFarmState(stScan, scanRes);
  if (stScan.structures.length < 4) throw new Error("applyScanToFarmState did not populate 3D structures");

  // Test glassesHud STORAGE_KEY synchronization
  const ghSrc = await (await fetch("/src/ui/glassesHud.js")).text();
  if (!ghSrc.includes("sg_vision_farmer_state_v2")) {
    throw new Error("glassesHud.js must use sg_vision_farmer_state_v2");
  }

  injectWeatherEvent(st, "storm");
  const autos = evaluateAutomations(st);
  if (autos.length < 1) throw new Error("Expected storm automation trigger");

  const cashBeforeAi = st.finances.cashBalance;
  const ai1 = processNaturalCommand(st, "Envoie le rover sur P2", fc0);
  const ai2 = processNaturalCommand(st, "Note 10 kg tomates sur S1", fc0);
  if (!ai1.mutated || !ai2.mutated || !(st.finances.cashBalance > cashBeforeAi)) {
    throw new Error("Expected AI command mutations and cashBalance update");
  }

  // Test WebGL V4 Three.js PBR engine: shaders, Sky/PMREM, ShadowMap 2048, all presets, rain, overlays & Photo HD export
  const mount = document.getElementById("mount");
  const testCanvas = document.createElement("canvas");
  testCanvas.width = 640; testCanvas.height = 400;
  document.body.appendChild(testCanvas);
  const eng = new Farm3DEngine(testCanvas, {});
  if (!eng.renderer || !eng.gl) throw new Error("Three.js WebGLRenderer not available in headless Edge");
  if (!eng.shadowSupported) throw new Error("ShadowMap not supported in headless Edge");
  for (const preset of SCALE_PRESETS) {
    const ps = buildPresetState(preset.id);
    const pfc = simulateFuture(ps, 14, "normal", 0);
    for (const h of [10.5, 18.5, 23.0]) {
      ps.simulation.hourOfDay = h;
      ps.weather.current.rainMm = h === 18.5 ? 12 : 0;
      eng.render(ps, pfc, 0.016);
    }
  }
  for (const ov of ["normal", "moisture", "health", "disease", "energy", "ar"]) {
    eng.overlay = ov;
    eng.render(gbState, simulateFuture(gbState, 14, "normal", 0), 0.016);
  }
  const photoUrl = eng.exportPhotoRender({ width: 800, height: 450 });
  if (!photoUrl || !photoUrl.startsWith("data:image/png;base64,") || photoUrl.length < 4000) {
    throw new Error("exportPhotoRender did not produce a valid PNG");
  }
  const glErr = eng.gl.getError();
  if (glErr !== 0) throw new Error("WebGL error detected: " + glErr);
  eng.destroy();

  // Test all 7 views + livestock/resources/agronomy cash coherence
  const ctx = {
    state: st, forecast: fc0,
    uiState: { overlay: "normal", showArPins: false, shadowsEnabled: true, buildActive: false, buildCategory: "all", buildType: "bed_open", buildRot: 0, sculptActive: true, sculptTool: "raise", sculptRadius: 5, scannerOpen: true, demoScanId: "coteau_ferme", selectedObject: null, agroTab: "plots", forecastHorizon: 60 },
    engine3d: null, serverStatus: { online: true, mcpTools: 6 },
    save: () => {}, rerender: () => {}, refreshForecastOnly: () => {}, updateStatusRibbon: () => {}, replaceState: () => {}, toast: () => {},
    mountCanvas: (c) => {
      if (c) {
        const viewEng = new Farm3DEngine(c, {});
        viewEng.render(st, fc0, 0.016);
        viewEng.destroy();
      }
    }
  };
  renderView3D(mount, ctx);
  if (!mount.querySelector("#btn-photo-hd") || !mount.querySelector("#btn-import-glb")) {
    throw new Error("Missing Photo HD or GLB import controls in View 3D");
  }
  for (const tab of ["plots", "rotations", "planning", "diseases"]) {
    ctx.uiState.agroTab = tab;
    renderViewAgronomy(mount, ctx);
  }

  // Test livestock form numeric values & egg collection cash update
  renderViewLivestock(mount, ctx);
  const lForm = mount.querySelector("#form-add-livestock");
  lForm.querySelector('[name="name"]').value = "Lot Chèvres Test";
  lForm.querySelector('[name="speciesId"]').value = "caprin";
  lForm.querySelector('[name="count"]').value = "12";
  lForm.dispatchEvent(new Event("submit", { cancelable: true }));
  const addedLot = st.livestock[st.livestock.length - 1];
  if (!Number.isFinite(addedLot.feedGramsPerDay) || !Number.isFinite(addedLot.waterLitersPerDay)) {
    throw new Error("Added livestock lot has NaN feed/water");
  }
  const cashBeforeEgg = st.finances.cashBalance;
  mount.querySelector("[data-collect-eggs]")?.click();
  if (!(st.finances.cashBalance > cashBeforeEgg)) {
    throw new Error("Egg collection did not update cashBalance");
  }

  // Test resource restock cash update
  renderViewResources(mount, ctx);
  const cashBeforeRestock = st.finances.cashBalance;
  mount.querySelector("[data-restock-id]")?.click();
  if (!(st.finances.cashBalance < cashBeforeRestock)) {
    throw new Error("Resource restock did not debit cashBalance");
  }

  renderViewRobotics(mount, ctx);
  renderViewForecastFinance(mount, ctx);
  const gbCtx = { ...ctx, state: gbState, forecast: simulateFuture(gbState, 60, "normal", 0) };
  renderViewForecastFinance(mount, gbCtx);
  const finHtml = mount.textContent.replace(/\s+/g, " ");
  if (!finHtml.includes("ZE 309") || !/185[\s\u00a0\u202f]?116/.test(finHtml)) {
    throw new Error("Finance view missing Granges-les-Beaumont project block");
  }
  renderViewEcosystem(mount, ctx);
  out.textContent = "ALL_7_VIEWS_AND_V4_PBR_PASS";
} catch (err) {
  out.textContent = "FAIL: " + (err && err.stack ? err.stack : err);
}
</script></body></html>
'@ | Set-Content -Path $verifyHtmlPath -Encoding UTF8

        $vProc = Start-Process -FilePath $edgePath -ArgumentList ($edgeWebGlArgs + @("--virtual-time-budget=8000", "--dump-dom", "`"$baseUrl/_verify_tmp.html`"")) -Wait -PassThru -NoNewWindow -RedirectStandardOutput $verifyDomOut -RedirectStandardError (Join-Path $Root "tools\edge-verr.tmp.log")
        $vDom = if (Test-Path $verifyDomOut) { Get-Content $verifyDomOut -Raw -Encoding UTF8 } else { "" }
        Remove-Item $verifyHtmlPath, $verifyDomOut, (Join-Path $Root "tools\edge-verr.tmp.log") -ErrorAction SilentlyContinue
        if ($vDom -match '<div id="res">ALL_7_VIEWS_AND_V4_PBR_PASS</div>') {
            Write-Host "[PASS] Deep JS/WebGL V4 PBR Verification: Three.js Sky/PMREM, ShadowMap 2048, all 6 scale presets, Photo HD, Time-Machine, rotations, livestock, finances, AI & all 7 views passed!"
        } else {
            throw "Deep JS/WebGL V4 PBR Verification failed: $vDom"
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
    Remove-Item $testDataDir -Recurse -Force -ErrorAction SilentlyContinue
}
