@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [dsh-gui] node was not found on PATH.
  pause
  exit /b 1
)
node "%~dp0dsh-gui.mjs" --stop
exit /b %errorlevel%