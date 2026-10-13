# Windows 작업 스케줄러에 「Wortling 매일」 작업을 등록한다(매일 06:40, 놓치면 켜질 때 바로).
# 실행: powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1   (지우기: -Remove)
param([switch]$Remove, [string]$At = "06:40")

$name = "Wortling Daily"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command node).Source

if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "removed: $name"
  exit 0
}

$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\daily.mjs" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "registered: $name at $At ($root)"
