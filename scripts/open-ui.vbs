' Ghent — open the web configuration UI in the default browser.
' This script is the Start Menu shortcut target so clicking the app opens
' the config/status page rather than doing nothing.
CreateObject("WScript.Shell").Run "cmd /c start http://localhost:9420/", 0, False
