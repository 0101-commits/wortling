# Windows 작업 스케줄러에 작업 하나를 등록한다(놓치면 켜질 때 바로).
#   「Wortling Backup」 평일 12:00  node scripts\daily.mjs --no-text --no-image — DB 백업만(앱 DB = Supabase, 공개 저장소라 서버에서 안 함)
#   글 채우기·그림은 .github/workflows/daily.yml(매일 12:17), 단어 검토·새 단어는 .github/workflows/words.yml(매일 05:17) — PC 가 꺼져 있어도 돈다
# 실행: powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1   (지우기: -Remove)
param([switch]$Remove, [string]$At = "12:00")

$daily = "Wortling Backup"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command node).Source
$old = @("Wortling Daily", "Wortling Words")   # 서버로 옮긴 옛 작업

if ($Remove) {
  foreach ($name in @($daily) + $old) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "removed: $name"
  }
  exit 0
}

foreach ($name in $old) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue }
$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\daily.mjs --no-text --no-image" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $daily -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "registered: $daily weekdays at $At ($root)"
