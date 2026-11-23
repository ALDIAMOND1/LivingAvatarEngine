@echo off
rem Starts the live avatar server with the OpenAI key read from a private text
rem file (never printed), then opens the page. Close the server window to stop.
setlocal
cd /d "%~dp0"
set "KEYFILE=%USERPROFILE%\OneDrive\Desktop\API SPEECH.txt"
set "SIMLIFILE=%USERPROFILE%\OneDrive\Desktop\SIMLI KEY.txt"
curl.exe -fsS --max-time 2 http://127.0.0.1:8766/api/status >nul 2>&1
if errorlevel 1 (
  start "Live avatar server" /D "%~dp0" cmd.exe /k node tools\start-live.mjs "%KEYFILE%" "%SIMLIFILE%"
  timeout /t 8 /nobreak >nul
)
rem The 3D head with its behaviour engine, and her trained video mouth laid over the lips.
rem Other modes: live.html (3D head, drawn mouth) and live.html?character=video (flat video face).
start "" "http://127.0.0.1:8766/live.html?mouth=video"
endlocal
