@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0set-cloudflare-auth.ps1"
echo.
pause
endlocal
