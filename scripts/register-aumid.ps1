# Creates an AUMID-tagged Start Menu shortcut so SnoreToast appears in
# Settings -> Notifications and toasts show "Ghent" as the source.
#
# Dev mode: run with no args -> uses node_modules\node-notifier vendor copy.
# MSI mode: -InstallRoot "C:\Program Files\Ghent\" -> uses the
#           snoretoast bundled with the install.
[CmdletBinding()]
param(
    [string]$InstallRoot
)

$shortcutPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Ghent.lnk"
$aumid = "Ghent.1.0"

if ($InstallRoot) {
    # Same trailing-slash/dot trim as install-task-msi.ps1
    $InstallRoot = $InstallRoot.TrimEnd('\').TrimEnd('.').TrimEnd('\')
    $openUiVbs = Join-Path $InstallRoot 'scripts\open-ui.vbs'
    $nodeExe   = Join-Path $InstallRoot 'node.exe'
} else {
    $openUiVbs = Join-Path $PSScriptRoot 'open-ui.vbs'
    $nodeExe   = ''
}
if (-not (Test-Path $openUiVbs)) {
    Write-Error "open-ui.vbs not found at: $openUiVbs"
    exit 1
}

Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\SnoreToast\GhePrNotifier.lnk" -ErrorAction SilentlyContinue
Remove-Item $shortcutPath -ErrorAction SilentlyContinue

$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($shortcutPath)
$sc.TargetPath  = $wscript
$sc.Arguments   = "`"$openUiVbs`""
$sc.Description = 'Open Ghent configuration and status'
if ($nodeExe -and (Test-Path $nodeExe)) {
    $sc.IconLocation = "$nodeExe,0"
}
$sc.Save()

$code = @'
using System;
using System.Runtime.InteropServices;

public static class ShortcutAumid {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    public static extern void SHGetPropertyStoreFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string path,
        IntPtr zero, int flags,
        ref Guid iid, [Out, MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        void GetCount(out uint cProps);
        void GetAt(uint iProp, out PropertyKey pkey);
        void GetValue(ref PropertyKey key, out PropVariant pv);
        void SetValue(ref PropertyKey key, ref PropVariant pv);
        void Commit();
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey { public Guid fmtid; public uint pid; }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr p;
    }

    [DllImport("ole32.dll", PreserveSig = false)]
    public static extern void PropVariantClear(ref PropVariant pvar);

    public static void SetAumid(string path, string aumid) {
        Guid iid = typeof(IPropertyStore).GUID;
        IPropertyStore ps;
        SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2, ref iid, out ps);
        var key = new PropertyKey {
            fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
            pid = 5
        };
        var pv = new PropVariant { vt = 31 };
        pv.p = Marshal.StringToCoTaskMemUni(aumid);
        try {
            ps.SetValue(ref key, ref pv);
            ps.Commit();
        } finally {
            PropVariantClear(ref pv);
            Marshal.ReleaseComObject(ps);
        }
    }
}
'@
Add-Type -TypeDefinition $code -Language CSharp
[ShortcutAumid]::SetAumid($shortcutPath, $aumid)
Write-Host "Created: $shortcutPath"
Write-Host "AUMID:   $aumid"
Test-Path $shortcutPath
