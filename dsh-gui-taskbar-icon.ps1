# dsh-gui-taskbar-icon.ps1 - swaps the app window's icon (taskbar included)
# to the DeepSeek whale. Runs best-effort after the gateway opens the window;
# a busy/blocked call simply fails silently and the Edge icon stays.
param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$IconPath
)
$ErrorActionPreference = 'SilentlyContinue'
if (-not (Test-Path $IconPath)) { exit 0 }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WinIcon
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")]
    public static extern IntPtr GetClassLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetClassLongPtrW")]
    public static extern IntPtr SetClassLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr LoadImage(IntPtr hinst, string lpszName, uint uType, int cx, int cy, uint fuLoad);

    public const int GCLP_HICON = -14;
    public const int GCLP_HICONSM = -34;
    public const uint IMAGE_ICON = 1;
    public const uint LR_LOADFROMFILE = 0x10;
    public const uint LR_DEFAULTSIZE = 0x40;
}
'@

$hits = New-Object System.Collections.ArrayList
$callback = [WinIcon+EnumWindowsProc]{
    param($h, $l)
    $winPid = 0
    [void][WinIcon]::GetWindowThreadProcessId($h, [ref]$winPid)
    if ($winPid -eq $ProcessId -and [WinIcon]::IsWindowVisible($h)) {
        [void]$hits.Add($h)
    }
    return $true
}
[void][WinIcon]::EnumWindows($callback, [IntPtr]::Zero)

if ($hits.Count -eq 0) { Write-Output "no window for pid $ProcessId"; exit 0 }

$big = [WinIcon]::LoadImage([IntPtr]::Zero, $IconPath, [WinIcon]::IMAGE_ICON, 0, 0,
    ([WinIcon]::LR_LOADFROMFILE -bor [WinIcon]::LR_DEFAULTSIZE))
$small = [WinIcon]::LoadImage([IntPtr]::Zero, $IconPath, [WinIcon]::IMAGE_ICON, 0, 0,
    ([WinIcon]::LR_LOADFROMFILE -bor [WinIcon]::LR_DEFAULTSIZE))

if ($big -eq [IntPtr]::Zero) { Write-Output "icon load failed"; exit 0 }

foreach ($h in $hits) {
    [void][WinIcon]::SetClassLongPtr($h, [WinIcon]::GCLP_HICON, $big)
    [void][WinIcon]::SetClassLongPtr($h, [WinIcon]::GCLP_HICONSM, $small)
}
Write-Output "patched $($hits.Count) window(s) of pid $ProcessId"