Stop-ScheduledTask -TaskName Ghent -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"C:\repos\personal-workspace\projects\ghe-pr-notifier\scripts\run-hidden.vbs`"" -WorkingDirectory "C:\repos\personal-workspace\projects\ghe-pr-notifier"
Set-ScheduledTask -TaskName Ghent -Action $action | Out-Null
Start-ScheduledTask -TaskName Ghent
Start-Sleep -Seconds 3
(Get-ScheduledTask -TaskName Ghent).State
Write-Host "---"
Get-Process powershell, wscript, node, cmd -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-1) } | Select-Object Name, Id, StartTime, MainWindowTitle | Format-Table -AutoSize
