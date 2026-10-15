# Windows 작업 스케줄러에 작업 둘을 등록한다(놓치면 켜질 때 바로).
#   「Wortling Backup」 평일 12:00  node scripts\daily.mjs --no-text --no-image — D1 백업만
#   글 채우기·그림은 깃허브 서버(.github/workflows/daily.yml, 매일 12:17)로 옮김 — PC 가 꺼져 있어도 돈다
#   「Wortling Words」 매주 일요일 05:30  node scripts\words\update.mjs — 원본 갱신·새 단어 넣기
# 실행: powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1   (둘 다 지우기: -Remove)
param([switch]$Remove, [string]$At = "12:00", [string]$WordsAt = "05:30")

$daily = "Wortling Backup"
$words = "Wortling Words"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command node).Source

if ($Remove) {
  foreach ($name in @($daily, $words, "Wortling Daily")) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "removed: $name"
  }
  exit 0
}

Unregister-ScheduledTask -TaskName "Wortling Daily" -Confirm:$false -ErrorAction SilentlyContinue   # 옛 매일 작업(그림은 깃허브로)
$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\daily.mjs --no-text --no-image" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $daily -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "registered: $daily weekdays at $At ($root)"

# kaikki 원본(약 1GB) 받기 + claude 채우기(최대 1000단어)까지 고려해 3시간
$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\words\update.mjs" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $WordsAt
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $words -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "registered: $words every Sunday at $WordsAt ($root)"
