' Invisible launcher for the Ghent dev scheduled task.
' Runs the bundled server.cjs with system node; no window, no orphan chains.
Set sh = CreateObject("WScript.Shell")
projectRoot = "C:\repos\personal-workspace\projects\ghe-pr-notifier"
nodeExe = "C:\Program Files\nodejs\node.exe"
serverCjs = projectRoot & "\build\bundle\server.cjs"
cmd = """" & nodeExe & """ """ & serverCjs & """"
' 0 = hidden window, False = don't wait
sh.Run cmd, 0, False
