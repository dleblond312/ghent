' Ghent — Start Menu launcher.
' If the service is not already running, start it; then open the config page.
'
' VBScript is used here because Windows Start Menu shortcuts can target it
' directly through wscript.exe, giving a hidden launch with no console flash.
' The script derives its own install root from its location so no hard-coded
' paths are needed in either dev or MSI-installed mode.

Const PORT = 9420

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

' Derive paths from the script's own location.
' Layout: <root>\scripts\open-ui.vbs  ->  <root>\ is the install/project root.
scriptDir   = fso.GetParentFolderName(WScript.ScriptFullName)
installRoot = fso.GetParentFolderName(scriptDir)

' ── Check whether the server is already listening ────────────────────────
' A fast HTTP probe via MSXML is more reliable than a WMI process scan
' because the process may exist but not yet be ready, or may have a different
' command line in dev vs MSI mode.
Dim isRunning : isRunning = False
On Error Resume Next
Dim xhr
Set xhr = CreateObject("MSXML2.ServerXMLHTTP.6.0")
xhr.Open "GET", "http://localhost:" & PORT & "/health", False
xhr.SetTimeouts 0, 1500, 1500, 1500
xhr.Send
If Err.Number = 0 Then
    If xhr.Status = 200 Then isRunning = True
End If
On Error GoTo 0
Set xhr = Nothing

' ── Start the service if needed ──────────────────────────────────────────
If Not isRunning Then
    ' MSI-installed: <root>\node.exe exists alongside server.cjs.
    ' Dev mode:      system Node.js is used; run-hidden.vbs knows the path.
    Dim runner
    If fso.FileExists(installRoot & "\node.exe") Then
        ' Installed mode — use the MSI hidden launcher.
        runner = scriptDir & "\run-hidden-msi.vbs"
    Else
        ' Dev mode — use the dev hidden launcher.
        runner = scriptDir & "\run-hidden.vbs"
    End If

    If fso.FileExists(runner) Then
        ' run-hidden*.vbs already guard against double-starts via WMI check.
        sh.Run "wscript.exe """ & runner & """", 0, False
        ' Give the server time to bind the port and show its tray icon.
        WScript.Sleep 3500
    End If
End If

' ── Open config page ─────────────────────────────────────────────────────
sh.Run "cmd /c start http://localhost:" & PORT & "/", 0, False

