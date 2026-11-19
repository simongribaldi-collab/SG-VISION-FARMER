@echo off
chcp 65001 >nul
echo [SG Vision Farmer] Arret du serveur local...
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/shutdown' -Method Post -TimeoutSec 2 | Out-Null; Write-Host 'Serveur arrete proprement.' } catch { Write-Host 'Serveur deja arrete.' }"
