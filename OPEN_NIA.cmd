@echo off
setlocal
cd /d "%~dp0"
curl.exe -fsS --max-time 2 http://127.0.0.1:8765/ >nul 2>&1
if errorlevel 1 (
  start "Ava Local Server" /D "%~dp0" cmd.exe /k python -m http.server 8765 --bind 127.0.0.1
  timeout /t 2 /nobreak >nul
)
start "" "http://127.0.0.1:8765/"
endlocal
