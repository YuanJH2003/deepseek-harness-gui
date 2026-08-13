# Creates the desktop shortcut "DeepSeek Harness GUI" that opens the app
# window with no console window (through dsh-gui.vbs), and stamps the same
# AppUserModelID the gateway uses for its Edge app window onto the shortcut,
# so the Windows taskbar shows the whale icon for that window as a separate
# taskbar app (never grouped into Edge).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $root 'dsh-gui.vbs'
if (-not (Test-Path $vbs)) { throw "dsh-gui.vbs missing at $vbs" }
$appId = 'DeepSeekHarnessGUI'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class LnkTaskbarId
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHGetPropertyStoreFromParsingName(
        string pszPath, IntPtr pbc, uint flags, ref Guid riid, out IntPtr ppv);

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        int GetCount(out uint cProps);
        int GetAt(uint iProp, out PROPERTYKEY pkey);
        int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
        int Commit();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROPERTYKEY
    {
        public Guid fmtid;
        public uint pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROPVARIANT
    {
        public ushort vt;
        public ushort wReserved1;
        public ushort wReserved2;
        public ushort wReserved3;
        public IntPtr p;
        public IntPtr p2;
        public IntPtr p3;
    }

    private static readonly Guid PKEY_AppUserModel_ID =
        new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    private static readonly Guid IID_IPropertyStore =
        new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");

    public static int Set(string lnkPath, string appId)
    {
        Guid iid = IID_IPropertyStore;
        IntPtr storePtr;
        int hr = SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, 2 /* GPS_READWRITE */, ref iid, out storePtr);
        if (hr != 0) return hr;
        IPropertyStore store = (IPropertyStore)Marshal.GetObjectForIUnknown(storePtr);
        try
        {
            PROPERTYKEY key = new PROPERTYKEY();
            key.fmtid = PKEY_AppUserModel_ID;
            key.pid = 5;
            IntPtr idPtr = Marshal.StringToCoTaskMemUni(appId);
            PROPVARIANT pv = new PROPVARIANT();
            pv.vt = 31; // VT_LPWSTR
            pv.p = idPtr;
            hr = store.SetValue(ref key, ref pv);
            Marshal.FreeCoTaskMem(idPtr);
            if (hr != 0) return hr;
            return store.Commit();
        }
        finally
        {
            Marshal.FinalReleaseComObject(store);
        }
    }
}
'@

function Stamp-Aumid($lnkPath) {
    $hr = [LnkTaskbarId]::Set($lnkPath, $appId)
    if ($hr -eq 0) { return $true }
    Write-Host "WARN: could not stamp the taskbar app id on $lnkPath (hr=0x$('{0:X8}' -f $hr))"
    return $false
}

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
$stamped = Stamp-Aumid $lnkPath

# A Start Menu copy with the same app id makes the taskbar association robust
# and doubles as a launcher. The wscript launcher works from any location.
$startMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'DeepSeek Harness GUI.lnk'
if (-not (Test-Path $startMenuDir)) {
    $ws.CreateShortcut($startMenuDir) | Out-Null
}
$mlnk = $ws.CreateShortcut($startMenuDir)
$mlnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$mlnk.Arguments = '"' + $vbs + '"'
$mlnk.WorkingDirectory = $root
$mlnk.Description = 'DeepSeek Harness desktop window (close the window to stop)'
$mlnk.IconLocation = (Join-Path $root 'dsh-gui.ico')
$mlnk.Save()
$stampedMenu = Stamp-Aumid $startMenuDir

if ($stamped) {
    Write-Host "OK: taskbar app id stamped; the app window will show the whale icon in the taskbar"
}
Write-Host "OK: shortcut created -> $lnkPath"
if ($stampedMenu) {
    Write-Host "OK: Start Menu entry created -> $startMenuDir"
}