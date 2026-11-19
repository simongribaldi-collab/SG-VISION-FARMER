param(
    [int]$Port = 8765,
    [string]$BindHost = "127.0.0.1",
    [string]$DataDir = ""
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$PublicDir = Join-Path $RootDir "public"
if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $DataDir = Join-Path $RootDir "data"
}
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

$StateFile = Join-Path $DataDir "farm-state.json"
$HudFile = Join-Path $DataDir "hud-state.json"
$TelemetryFile = Join-Path $DataDir "telemetry-log.json"
$ModelsDir = Join-Path $DataDir "models"
if (-not (Test-Path $ModelsDir)) {
    New-Item -ItemType Directory -Path $ModelsDir -Force | Out-Null
}
$PidFile = Join-Path $DataDir "server.pid"
$PID | Out-File -FilePath $PidFile -Encoding ascii -Force

$MimeTypes = @{
    ".html"        = "text/html; charset=utf-8"
    ".js"          = "application/javascript; charset=utf-8"
    ".mjs"         = "application/javascript; charset=utf-8"
    ".css"         = "text/css; charset=utf-8"
    ".json"        = "application/json; charset=utf-8"
    ".webmanifest" = "application/manifest+json; charset=utf-8"
    ".svg"         = "image/svg+xml"
    ".png"         = "image/png"
    ".jpg"         = "image/jpeg"
    ".webp"        = "image/webp"
    ".glb"         = "model/gltf-binary"
    ".gltf"        = "model/gltf+json"
    ".bin"         = "application/octet-stream"
    ".hdr"         = "application/octet-stream"
    ".ico"         = "image/x-icon"
    ".txt"         = "text/plain; charset=utf-8"
}

$StatusReasons = @{
    200 = "OK"
    202 = "Accepted"
    204 = "No Content"
    400 = "Bad Request"
    403 = "Forbidden"
    404 = "Not Found"
    500 = "Internal Server Error"
}

function Send-HttpResponse([System.IO.Stream]$Stream, [byte[]]$BodyBytes, [string]$ContentType, [int]$StatusCode = 200) {
    $reason = if ($StatusReasons.ContainsKey($StatusCode)) { $StatusReasons[$StatusCode] } else { "OK" }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append("HTTP/1.1 $StatusCode $reason`r`n")
    [void]$sb.Append("Content-Type: $ContentType`r`n")
    [void]$sb.Append("Content-Length: $($BodyBytes.Length)`r`n")
    [void]$sb.Append("Access-Control-Allow-Origin: *`r`n")
    [void]$sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n")
    [void]$sb.Append("Access-Control-Allow-Headers: Content-Type, Authorization, Mcp-Session-Id`r`n")
    [void]$sb.Append("Cache-Control: no-store`r`n")
    [void]$sb.Append("Connection: close`r`n`r`n")
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($sb.ToString())
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($BodyBytes.Length -gt 0) {
        $Stream.Write($BodyBytes, 0, $BodyBytes.Length)
    }
    $Stream.Flush()
}

function Send-Text([System.IO.Stream]$Stream, [string]$Text, [string]$ContentType = "application/json; charset=utf-8", [int]$StatusCode = 200) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    Send-HttpResponse $Stream $bytes $ContentType $StatusCode
}

function Send-Json([System.IO.Stream]$Stream, $Object, [int]$StatusCode = 200) {
    $json = $Object | ConvertTo-Json -Depth 15 -Compress
    Send-Text $Stream $json "application/json; charset=utf-8" $StatusCode
}

function Read-HttpRequest([System.IO.Stream]$Stream) {
    $buf = New-Object byte[] 65536
    $ms = New-Object System.IO.MemoryStream
    $headerEnd = -1

    while ($headerEnd -lt 0) {
        $read = $Stream.Read($buf, 0, $buf.Length)
        if ($read -le 0) { return $null }
        $ms.Write($buf, 0, $read)
        $arr = $ms.ToArray()
        for ($i = 0; $i -le $arr.Length - 4; $i++) {
            if ($arr[$i] -eq 13 -and $arr[$i + 1] -eq 10 -and $arr[$i + 2] -eq 13 -and $arr[$i + 3] -eq 10) {
                $headerEnd = $i
                break
            }
        }
        if ($ms.Length -gt 262144) { break }
    }
    if ($headerEnd -lt 0) { return $null }

    $allBytes = $ms.ToArray()
    $headerStr = [System.Text.Encoding]::ASCII.GetString($allBytes, 0, $headerEnd)
    $lines = $headerStr -split "`r`n"
    $parts = $lines[0] -split " "
    $method = $parts[0].ToUpperInvariant()
    $rawUrl = if ($parts.Length -ge 2) { $parts[1] } else { "/" }
    $path = ($rawUrl -split "\?")[0]

    $contentLen = 0
    for ($i = 1; $i -lt $lines.Length; $i++) {
        $idx = $lines[$i].IndexOf(":")
        if ($idx -gt 0) {
            $k = $lines[$i].Substring(0, $idx).Trim().ToLowerInvariant()
            $v = $lines[$i].Substring($idx + 1).Trim()
            if ($k -eq "content-length") {
                [int]::TryParse($v, [ref]$contentLen) | Out-Null
            }
        }
    }

    $bodyStart = $headerEnd + 4
    $bodyBytes = New-Object byte[] 0
    $bodyText = ""
    if ($contentLen -gt 0 -and $contentLen -le 26214400) {
        $bodyMs = New-Object System.IO.MemoryStream
        $already = $allBytes.Length - $bodyStart
        if ($already -gt 0) {
            $take = [Math]::Min($already, $contentLen)
            $bodyMs.Write($allBytes, $bodyStart, $take)
        }
        while ($bodyMs.Length -lt $contentLen) {
            $need = [Math]::Min($buf.Length, $contentLen - [int]$bodyMs.Length)
            $r = $Stream.Read($buf, 0, $need)
            if ($r -le 0) { break }
            $bodyMs.Write($buf, 0, $r)
        }
        $bodyBytes = $bodyMs.ToArray()
        if (-not $path.StartsWith("/api/models")) {
            $bodyText = [System.Text.Encoding]::UTF8.GetString($bodyBytes)
        }
        $bodyMs.Dispose()
    }
    $ms.Dispose()
    return @{ Method = $method; Path = $path; RawUrl = $rawUrl; Body = $bodyText; BodyBytes = $bodyBytes }
}

function Get-LocalStateObject {
    if (Test-Path $StateFile) {
        try {
            $raw = [System.IO.File]::ReadAllText($StateFile, [System.Text.Encoding]::UTF8)
            return ($raw | ConvertFrom-Json)
        } catch {
            return $null
        }
    }
    return $null
}

function Read-HudObject {
    if (Test-Path $HudFile) {
        try {
            $raw = [System.IO.File]::ReadAllText($HudFile, [System.Text.Encoding]::UTF8)
            return ($raw | ConvertFrom-Json)
        } catch {}
    }
    return [PSCustomObject]@{ alerts = @(); commands = @(); snapshot = $null; updatedAt = (Get-Date).ToString("o") }
}

function Save-HudObject($HudObj) {
    [System.IO.File]::WriteAllText($HudFile, ($HudObj | ConvertTo-Json -Depth 12), [System.Text.Encoding]::UTF8)
}

function Invoke-McpTool([string]$ToolName, $ToolArgs) {
    $state = Get-LocalStateObject
    switch ($ToolName) {
        "farm_overview" {
            if (-not $state) {
                return @{ status = "empty"; message = "Aucune sauvegarde locale encore enregistree. Ouvrez SG Vision Farmer dans le navigateur pour initialiser la ferme." }
            }
            return @{
                farmName    = $state.farm.name
                scale       = $state.farm.scale
                areaHa      = $state.farm.areaHa
                location    = $state.farm.location
                activities  = $state.farm.activities
                dayOffset   = $state.simulation.dayOffset
                plotsCount  = ($state.plots | Measure-Object).Count
                robotsCount = ($state.equipment | Where-Object { $_.autonomous -eq $true } | Measure-Object).Count
                flocksCount = ($state.livestock | Measure-Object).Count
                weather     = $state.weather.current
            }
        }
        "weather_and_forecast" {
            if (-not $state) { return @{ error = "Etat ferme absent" } }
            return @{
                location = $state.farm.location
                current  = $state.weather.current
                forecast = ($state.weather.forecast | Select-Object -First 7)
            }
        }
        "list_plots_and_crops" {
            if (-not $state) { return @{ error = "Etat ferme absent" } }
            $items = @()
            foreach ($p in $state.plots) {
                $items += @{
                    id          = $p.id
                    name        = $p.name
                    zone        = $p.zone
                    areaM2      = $p.areaM2
                    cropId      = $p.cropId
                    stage       = $p.stage
                    moisturePct = $p.moisturePct
                    healthPct   = $p.healthPct
                    diseaseRisk = $p.diseaseRisk
                }
            }
            return @{ plots = $items }
        }
        "inventory_and_finances" {
            if (-not $state) { return @{ error = "Etat ferme absent" } }
            return @{
                resources = $state.resources
                finances  = $state.finances
            }
        }
        "control_robot_or_automation" {
            $targetId = if ($ToolArgs.targetId) { [string]$ToolArgs.targetId } else { "" }
            $action = if ($ToolArgs.action) { [string]$ToolArgs.action } else { "status" }
            $plotId = if ($ToolArgs.plotId) { [string]$ToolArgs.plotId } else { "" }
            $cmd = @{
                id        = "cmd-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                timestamp = (Get-Date).ToString("o")
                source    = "mcp"
                targetId  = $targetId
                action    = $action
                plotId    = $plotId
                status    = "queued"
            }
            $hud = Read-HudObject
            $cmds = @($cmd)
            if ($hud.commands) { $cmds += @($hud.commands | Select-Object -First 19) }
            $nextHud = @{
                alerts    = if ($hud.alerts) { $hud.alerts } else { @() }
                commands  = $cmds
                snapshot  = $hud.snapshot
                updatedAt = (Get-Date).ToString("o")
            }
            Save-HudObject $nextHud
            return @{ accepted = $true; command = $cmd; note = "Commande transmise au jumeau 3D et aux lunettes AR." }
        }
        "glasses_push_hud" {
            $message = if ($ToolArgs.message) { [string]$ToolArgs.message } else { "Alerte ferme" }
            $severity = if ($ToolArgs.severity) { [string]$ToolArgs.severity } else { "info" }
            $entry = @{
                id        = "hud-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                timestamp = (Get-Date).ToString("o")
                message   = $message
                severity  = $severity
            }
            $hud = Read-HudObject
            $alerts = @($entry)
            if ($hud.alerts) { $alerts += @($hud.alerts | Select-Object -First 14) }
            $nextHud = @{
                alerts    = $alerts
                commands  = if ($hud.commands) { $hud.commands } else { @() }
                snapshot  = $hud.snapshot
                updatedAt = (Get-Date).ToString("o")
            }
            Save-HudObject $nextHud
            return @{ pushed = $true; entry = $entry }
        }
        default {
            return @{ error = "Outil MCP inconnu: $ToolName" }
        }
    }
}

$McpTools = @(
    @{
        name        = "farm_overview"
        description = "Retourne la synthese SG Vision Farmer (echelle, localisation, activites, meteo, planches, robots, cheptel)."
        inputSchema = @{ type = "object"; properties = @{} }
    },
    @{
        name        = "weather_and_forecast"
        description = "Lit la station meteo connectee et les previsions climatiques a 7 jours."
        inputSchema = @{ type = "object"; properties = @{} }
    },
    @{
        name        = "list_plots_and_crops"
        description = "Liste toutes les planches de culture et serres avec culture, stade, humidite du sol, sante et risque maladie."
        inputSchema = @{ type = "object"; properties = @{} }
    },
    @{
        name        = "inventory_and_finances"
        description = "Retourne les ressources (eau, electricite, semences, alimentation, agrofournitures) et la situation financiere."
        inputSchema = @{ type = "object"; properties = @{} }
    },
    @{
        name        = "control_robot_or_automation"
        description = "Envoie une commande a distance a un robot autonome ou une automatisation (dispatch, return_home, pause, irrigate, vent_open, coop_toggle)."
        inputSchema = @{
            type       = "object"
            properties = @{
                targetId = @{ type = "string"; description = "ID du robot ou equipement" }
                action   = @{ type = "string"; description = "dispatch, return_home, pause, irrigate, vent_open, coop_toggle" }
                plotId   = @{ type = "string"; description = "ID de planche ou serre cible (optionnel)" }
            }
            required   = @("targetId", "action")
        }
    },
    @{
        name        = "glasses_push_hud"
        description = "Envoie une alerte ou consigne directement dans les lunettes connectees AR."
        inputSchema = @{
            type       = "object"
            properties = @{
                message  = @{ type = "string"; description = "Message court pour l'affichage tete haute" }
                severity = @{ type = "string"; enum = @("info", "warn", "critical") }
            }
            required   = @("message")
        }
    }
)

if ($BindHost -eq "0.0.0.0" -or $BindHost -eq "*") {
    $Listener = [System.Net.Sockets.TcpListener]::Create($Port)
} else {
    $Listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
}
$Listener.Start()

$Prefix = "http://localhost:${Port}/"
$StartTime = Get-Date
Write-Host "[SG Vision Farmer] Serveur actif sur $Prefix"
Write-Host "[SG Vision Farmer] Endpoint MCP   : ${Prefix}mcp"
Write-Host "[SG Vision Farmer] Lunettes AR    : ${Prefix}glasses.html"

$Running = $true
try {
    while ($Running) {
        $client = $Listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $stream.ReadTimeout = 5000
            $req = Read-HttpRequest $stream
            if (-not $req) { continue }

            $method = $req.Method
            $path = $req.Path

            if ($method -eq "OPTIONS") {
                Send-Text $stream "" "text/plain" 204
                continue
            }

            if ($path -eq "/api/health") {
                Send-Json $stream @{
                    ok        = $true
                    app       = "SG Vision Farmer"
                    version   = "4.0.0"
                    uptimeSec = [int]((Get-Date) - $StartTime).TotalSeconds
                    hasState  = (Test-Path $StateFile)
                    mcpTools  = $McpTools.Count
                    host      = $Prefix
                }
                continue
            }

            if ($path -eq "/api/models") {
                if ($method -eq "GET") {
                    $list = Get-ChildItem -Path $ModelsDir -File -ErrorAction SilentlyContinue | ForEach-Object {
                        @{ name = $_.Name; url = "/api/models/$($_.Name)"; bytes = $_.Length }
                    }
                    Send-Json $stream @{ ok = $true; models = @($list) } 200
                    continue
                }
                if ($method -eq "POST") {
                    $rawName = "model.glb"
                    if ($req.RawUrl -match '[?&]name=([^&]+)') {
                        $rawName = [System.Uri]::UnescapeDataString($Matches[1])
                    }
                    $rawName = [System.IO.Path]::GetFileName($rawName)
                    $safeName = $rawName -replace '[^a-zA-Z0-9._-]', '_'
                    $ext = [System.IO.Path]::GetExtension($safeName).ToLowerInvariant()
                    if ($ext -ne ".glb" -and $ext -ne ".gltf") {
                        Send-Json $stream @{ error = "Extension invalide (.glb ou .gltf requis)" } 400
                        continue
                    }
                    if (-not $req.BodyBytes -or $req.BodyBytes.Length -eq 0) {
                        Send-Json $stream @{ error = "Fichier 3D vide" } 400
                        continue
                    }
                    $destPath = [System.IO.Path]::GetFullPath((Join-Path $ModelsDir $safeName))
                    $modelsRootFull = [System.IO.Path]::GetFullPath($ModelsDir)
                    if (-not $destPath.StartsWith($modelsRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
                        Send-Json $stream @{ error = "Forbidden" } 403
                        continue
                    }
                    [System.IO.File]::WriteAllBytes($destPath, $req.BodyBytes)
                    Send-Json $stream @{ ok = $true; name = $safeName; url = "/api/models/$safeName"; bytes = $req.BodyBytes.Length } 200
                    continue
                }
            }

            if ($path.StartsWith("/api/models/") -and $method -eq "GET") {
                $reqName = $path.Substring("/api/models/".Length)
                $safeName = [System.IO.Path]::GetFileName($reqName) -replace '[^a-zA-Z0-9._-]', '_'
                $modelPath = [System.IO.Path]::GetFullPath((Join-Path $ModelsDir $safeName))
                $modelsRootFull = [System.IO.Path]::GetFullPath($ModelsDir)
                if ($modelPath.StartsWith($modelsRootFull, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path $modelPath)) {
                    $ext = [System.IO.Path]::GetExtension($modelPath).ToLowerInvariant()
                    $mime = if ($MimeTypes.ContainsKey($ext)) { $MimeTypes[$ext] } else { "application/octet-stream" }
                    $bytes = [System.IO.File]::ReadAllBytes($modelPath)
                    Send-HttpResponse $stream $bytes $mime 200
                } else {
                    Send-Json $stream @{ error = "Model not found" } 404
                }
                continue
            }

            if ($path -eq "/api/shutdown" -and $method -eq "POST") {
                Send-Json $stream @{ ok = $true; shuttingDown = $true }
                $Running = $false
                continue
            }

            if ($path -eq "/api/state") {
                if ($method -eq "GET") {
                    if (Test-Path $StateFile) {
                        $raw = [System.IO.File]::ReadAllText($StateFile, [System.Text.Encoding]::UTF8)
                        Send-Text $stream $raw "application/json; charset=utf-8" 200
                    } else {
                        Send-Json $stream @{ exists = $false } 200
                    }
                    continue
                }
                if ($method -eq "POST") {
                    if ([string]::IsNullOrWhiteSpace($req.Body)) {
                        Send-Json $stream @{ error = "Empty state payload" } 400
                        continue
                    }
                    [System.IO.File]::WriteAllText($StateFile, $req.Body, [System.Text.Encoding]::UTF8)
                    Send-Json $stream @{ ok = $true; savedAt = (Get-Date).ToString("o"); bytes = $req.Body.Length } 200
                    continue
                }
            }

            if ($path -eq "/api/hud") {
                if ($method -eq "GET") {
                    if (Test-Path $HudFile) {
                        $raw = [System.IO.File]::ReadAllText($HudFile, [System.Text.Encoding]::UTF8)
                        Send-Text $stream $raw "application/json; charset=utf-8" 200
                    } else {
                        Send-Json $stream @{ alerts = @(); commands = @(); snapshot = $null } 200
                    }
                    continue
                }
                if ($method -eq "POST") {
                    if ([string]::IsNullOrWhiteSpace($req.Body)) {
                        Send-Json $stream @{ error = "Empty hud payload" } 400
                        continue
                    }
                    [System.IO.File]::WriteAllText($HudFile, $req.Body, [System.Text.Encoding]::UTF8)
                    Send-Json $stream @{ ok = $true } 200
                    continue
                }
            }

            if ($path -eq "/api/telemetry") {
                if ($method -eq "GET") {
                    if (Test-Path $TelemetryFile) {
                        $raw = [System.IO.File]::ReadAllText($TelemetryFile, [System.Text.Encoding]::UTF8)
                        Send-Text $stream $raw "application/json; charset=utf-8" 200
                    } else {
                        Send-Text $stream "[]" "application/json; charset=utf-8" 200
                    }
                    continue
                }
                if ($method -eq "POST") {
                    $entry = @{ receivedAt = (Get-Date).ToString("o"); payload = $req.Body }
                    $list = @($entry)
                    if (Test-Path $TelemetryFile) {
                        try {
                            $prev = [System.IO.File]::ReadAllText($TelemetryFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
                            $list = @($entry) + @($prev | Select-Object -First 49)
                        } catch {}
                    }
                    [System.IO.File]::WriteAllText($TelemetryFile, ($list | ConvertTo-Json -Depth 10), [System.Text.Encoding]::UTF8)
                    Send-Json $stream @{ ok = $true; stored = $true } 200
                    continue
                }
            }

            if ($path -eq "/api/mcp-config") {
                $cfg = @{
                    mcpServers = @{
                        "sg-vision-farmer" = @{
                            type = "http"
                            url  = "${Prefix}mcp"
                        }
                    }
                }
                Send-Json $stream $cfg 200
                continue
            }

            if ($path -eq "/mcp" -and $method -eq "POST") {
                $rpc = $req.Body | ConvertFrom-Json
                $rpcId = $rpc.id
                $rpcMethod = [string]$rpc.method

                $result = $null
                if ($rpcMethod -eq "initialize") {
                    $result = @{
                        protocolVersion = "2025-03-26"
                        capabilities    = @{ tools = @{ listChanged = $false } }
                        serverInfo      = @{ name = "SG-Vision-Farmer-MCP"; version = "3.0.0" }
                    }
                } elseif ($rpcMethod -eq "notifications/initialized") {
                    Send-Text $stream "" "application/json" 202
                    continue
                } elseif ($rpcMethod -eq "tools/list") {
                    $result = @{ tools = $McpTools }
                } elseif ($rpcMethod -eq "tools/call") {
                    $tName = [string]$rpc.params.name
                    $tArgs = $rpc.params.arguments
                    $toolOut = Invoke-McpTool $tName $tArgs
                    $result = @{
                        content = @(
                            @{
                                type = "text"
                                text = ($toolOut | ConvertTo-Json -Depth 10)
                            }
                        )
                    }
                } else {
                    Send-Json $stream @{
                        jsonrpc = "2.0"
                        id      = $rpcId
                        error   = @{ code = -32601; message = "Method not found: $rpcMethod" }
                    } 200
                    continue
                }

                Send-Json $stream @{
                    jsonrpc = "2.0"
                    id      = $rpcId
                    result  = $result
                } 200
                continue
            }

            # Static files
            $relPath = $path.TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($relPath)) { $relPath = "index.html" }
            $relPath = $relPath -replace '/', '\'
            $fullPath = [System.IO.Path]::GetFullPath((Join-Path $PublicDir $relPath))
            $publicRootFull = [System.IO.Path]::GetFullPath($PublicDir)

            if (-not $fullPath.StartsWith($publicRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
                Send-Json $stream @{ error = "Forbidden" } 403
                continue
            }

            if ((Test-Path $fullPath) -and -not (Get-Item $fullPath).PSIsContainer) {
                $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
                $mime = if ($MimeTypes.ContainsKey($ext)) { $MimeTypes[$ext] } else { "application/octet-stream" }
                $bytes = [System.IO.File]::ReadAllBytes($fullPath)
                Send-HttpResponse $stream $bytes $mime 200
            } else {
                if ([string]::IsNullOrEmpty([System.IO.Path]::GetExtension($fullPath))) {
                    $indexFallback = Join-Path $PublicDir "index.html"
                    $bytes = [System.IO.File]::ReadAllBytes($indexFallback)
                    Send-HttpResponse $stream $bytes "text/html; charset=utf-8" 200
                } else {
                    Send-Json $stream @{ error = "Not found"; path = $path } 404
                }
            }
        } catch {
            try {
                Send-Json $stream @{ error = $_.Exception.Message } 500
            } catch {}
        } finally {
            $client.Close()
        }
    }
} finally {
    $Listener.Stop()
    if (Test-Path $PidFile) { Remove-Item $PidFile -ErrorAction SilentlyContinue }
    Write-Host "[SG Vision Farmer] Serveur arrete."
}
