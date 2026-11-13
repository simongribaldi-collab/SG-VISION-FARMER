@echo off
chcp 65001 >nul
echo [SG Vision Farmer] Arret du serveur local...
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://localhost:8765/api/shutdown' -Method Post -TimeoutSec 2 | Out-Null; Write-Host 'Serveur arrete proprement.' } catch { Write-Host 'Serveur deja arrete.' }"
