@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health' -TimeoutSec 1; if ($r.ok) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel%==0 (
  echo [SG Vision Farmer] Serveur deja actif sur http://localhost:8765/
  start "" "http://localhost:8765/"
  exit /b 0
)
echo [SG Vision Farmer] Demarrage du serveur local sur http://localhost:8765 ...
start "SG Vision Farmer Server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\server.ps1" -Port 8765
timeout /t 2 /nobreak >nul
start "" "http://localhost:8765/"
