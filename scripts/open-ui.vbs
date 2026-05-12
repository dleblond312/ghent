' Ghent — open the web configuration UI in the default browser.
' This script is the Start Menu shortcut target so clicking the app opens
' the config/status page rather than doing nothing.
' VBScript is used here because Windows Start Menu shortcuts can target it
' directly through wscript.exe, which opens the UI without flashing a console.
' Ghent uses this tiny launcher so the shortcut behaves like a normal app.
CreateObject("WScript.Shell").Run "cmd /c start http://localhost:9420/", 0, False
