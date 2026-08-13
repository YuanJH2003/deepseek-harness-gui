# dsh-gui-taskbar-icon.ps1 - swaps the app window's icon (taskbar included)
# to the DeepSeek whale. Runs best-effort after the gateway opens the window;
# a busy/blocked call simply fails silently and the Edge icon stays.
#
# Two mechanisms together cover the taskbar button:
#   * WM_SETICON (big+small) - what Explorer reads for the taskbar button;
#   * SetClassLongPtr GCLP_HICON/SM - legacy class-level override;
#   * SWP_FRAMECHANGED - nudges the window to repaint its chrome.
# Windows are matched by the spawned pid, plus (when -ProfileDir is given)
# every process whose command line contains that profile dir: Edge may host
# the visible window in a different process than the one the gateway spawned.
param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$IconPath,
    [Parameter(Mandatory = $false)][string]$ProfileDir = ''
)
$ErrorActionPreference = 'SilentlyContinue'
if (-not (Test-Path $IconPath)) { exit 0 }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WinIcon2
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

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    public const int GCLP_HICON = -14;
    public const int GCLP_HICONSM = -34;
    public const uint WM_SETICON = 0x0080;
    public const int ICON_BIG = 1;
    public const int ICON_SMALL = 0;
    public const uint IMAGE_ICON = 1;
    public const uint LR_LOADFROMFILE = 0x10;
    public const uint LR_DEFAULTSIZE = 0x40;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_FRAMECHANGED = 0x0020;
}
'@

# Candidate window owners: the spawned pid, plus any process citing the
# profile dir (Edge can host the app window outside the spawned process).
$candidatePids = New-Object System.Collections.ArrayList
[void]$candidatePids.Add($ProcessId)
if ($ProfileDir) {
    Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.CommandLine -like "*$ProfileDir*" -and -not $candidatePids.Contains($_.ProcessId)) {
            [void]$candidatePids.Add($_.ProcessId)
        }
    }
}

$hits = New-Object System.Collections.ArrayList
$callback = [WinIcon2+EnumWindowsProc]{
    param($h, $l)
    $winPid = 0
    [void][WinIcon2]::GetWindowThreadProcessId($h, [ref]$winPid)
    if ($candidatePids.Contains($winPid) -and [WinIcon2]::IsWindowVisible($h)) {
        [void]$hits.Add($h)
    }
    return $true
}
[void][WinIcon2]::EnumWindows($callback, [IntPtr]::Zero)

if ($hits.Count -eq 0) { Write-Output "no window for pid $ProcessId"; exit 0 }

$big = [WinIcon2]::LoadImage([IntPtr]::Zero, $IconPath, [WinIcon2]::IMAGE_ICON, 0, 0,
    ([WinIcon2]::LR_LOADFROMFILE -bor [WinIcon2]::LR_DEFAULTSIZE))
$small = [WinIcon2]::LoadImage([IntPtr]::Zero, $IconPath, [WinIcon2]::IMAGE_ICON, 16, 16,
    ([WinIcon2]::LR_LOADFROMFILE -bor 0x40))

if ($big -eq [IntPtr]::Zero) { Write-Output "icon load failed"; exit 0 }

foreach ($h in $hits) {
    [void][WinIcon2]::SendMessage($h, [WinIcon2]::WM_SETICON, [IntPtr][WinIcon2]::ICON_BIG, $big)
    [void][WinIcon2]::SendMessage($h, [WinIcon2]::WM_SETICON, [IntPtr][WinIcon2]::ICON_SMALL, $small)
    [void][WinIcon2]::SetClassLongPtr($h, [WinIcon2]::GCLP_HICON, $big)
    [void][WinIcon2]::SetClassLongPtr($h, [WinIcon2]::GCLP_HICONSM, $small)
    # Force the window to repaint its chrome so Explorer re-reads the icon.
    [void][WinIcon2]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 0, 0,
        ([WinIcon2]::SWP_NOSIZE -bor [WinIcon2]::SWP_NOMOVE -bor [WinIcon2]::SWP_NOZORDER -bor [WinIcon2]::SWP_NOACTIVATE -bor [WinIcon2]::SWP_FRAMECHANGED))
}
Write-Output "patched $($hits.Count) window(s)"