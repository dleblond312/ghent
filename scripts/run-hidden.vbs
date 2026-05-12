' Invisible launcher for the Ghent dev scheduled task.
' Runs the bundled server.cjs with system node; no window, no orphan chains.
' VBScript is used here because Scheduled Task actions can hand off to
' wscript.exe for a hidden launcher without shipping a compiled helper.
' That keeps the dev startup path lightweight and avoids a console flash.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectRoot = fso.GetParentFolderName(scriptDir)
nodeExe = "C:\Program Files\nodejs\node.exe"
serverCjs = projectRoot & "\build\bundle\server.cjs"
cmd = """" & nodeExe & """ """ & serverCjs & """"
'' 0 = hidden window, False = don't wait
sh.Run cmd, 0, False
