@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [SG Vision Farmer] Demarrage du serveur local sur http://localhost:8765 ...
start "SG Vision Farmer Server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\server.ps1" -Port 8765
timeout /t 2 /nobreak >nul
start "" "http://localhost:8765/"
