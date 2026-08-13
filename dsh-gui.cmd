@echo off
setlocal
cd /d "%~dp0"

rem "--make-shortcut" creates the desktop icon and exits.
for %%a in (%*) do if /i "%%~a"=="--make-shortcut" goto make-shortcut

title dsh-gui - DeepSeek Harness desktop
where node >nul 2>nul
if errorlevel 1 (
  echo [dsh-gui] node was not found on PATH.
  echo           Install Node.js 22 or newer from https://nodejs.org and retry.
  pause
  exit /b 1
)
node "%~dp0dsh-gui.mjs" %*
set "code=%errorlevel%"
if not "%code%"=="0" pause
exit /b %code%

:make-shortcut
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dsh-gui-shortcut.ps1"
if errorlevel 1 (
  echo [dsh-gui] shortcut creation failed.
  pause
  exit /b 1
)
echo.
echo 桌面图标已创建: DeepSeek Harness GUI.lnk
echo 以后双击这个图标即可无控制台打开，关闭窗口即停止服务。
pause
exit /b 0