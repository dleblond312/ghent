' Invisible launcher for the installed Ghent.
' Runs the bundled node.exe with server.cjs, logs to %LOCALAPPDATA%\Ghent\task.log.
' Resolves its own install root from WScript.ScriptFullName so the MSI doesn't
' need to bake in any paths.
' VBScript stays here because the installed task needs a hidden launcher that
' can resolve its install root at runtime without an extra EXE or shell wrapper.
' WScript gives us that on every supported Windows install.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

' Script lives at <installRoot>\scripts\run-hidden-msi.vbs, so root = parent's parent.
scriptDir   = fso.GetParentFolderName(WScript.ScriptFullName)
installRoot = fso.GetParentFolderName(scriptDir)

nodeExe   = installRoot & "\node.exe"
serverCjs = installRoot & "\server.cjs"

logDir = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Ghent"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = logDir & "\task.log"

' Guard: bail out if another instance of server.cjs is already running.
' This prevents EADDRINUSE when the scheduled task fires while a previous
' launch is still alive (e.g. user woke from sleep with the task still queued).
Set wmi  = GetObject("winmgmts://./root/cimv2")
Set procs = wmi.ExecQuery("SELECT * FROM Win32_Process WHERE CommandLine LIKE '%server.cjs%'")
If procs.Count > 0 Then WScript.Quit 0

' Rotate task.log when it exceeds 5 MB so it never grows unbounded.
Const MAX_LOG_BYTES = 5242880
If fso.FileExists(logFile) Then
  If fso.GetFile(logFile).Size > MAX_LOG_BYTES Then
    oldLog = logFile & ".old"
    If fso.FileExists(oldLog) Then fso.DeleteFile(oldLog)
    fso.MoveFile logFile, oldLog
  End If
End If

' Quote each argument explicitly to survive paths with spaces (Program Files).
cmd = "cmd /c """"" & nodeExe & """ """ & serverCjs & """ >> """ & logFile & """ 2>&1"""

'' 0 = hidden window, False = don't wait
sh.Run cmd, 0, False
