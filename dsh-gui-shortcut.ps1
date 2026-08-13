# Creates the desktop shortcut "DeepSeek Harness GUI" that opens the app
# window with no console window (through dsh-gui.vbs).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $root 'dsh-gui.vbs'
if (-not (Test-Path $vbs)) { throw "dsh-gui.vbs missing at $vbs" }
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'DeepSeek Harness GUI.lnk'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$lnk.Arguments = '"' + $vbs + '"'
$lnk.WorkingDirectory = $root
$lnk.Description = 'DeepSeek Harness desktop window (close the window to stop)'
$lnk.IconLocation = (Join-Path $root 'dsh-gui.ico')
$lnk.Save()
Write-Host "OK: shortcut created -> $lnkPath"