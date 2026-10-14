# Windows 작업 스케줄러에 작업 둘을 등록한다(놓치면 켜질 때 바로).
#   「Wortling Daily」 매일 09:10  node scripts\daily.mjs        — 글 채우기·그림·백업
#   그림 무료 몫(Workers AI 10,000 뉴런)은 UTC 0시 = 한국 09:00 에 초기화 → 09:10 이면 매일 작업이 늘 새 몫의 첫 사용자
#   「Wortling Words」 매주 일요일 05:30  node scripts\words\update.mjs — 원본 갱신·새 단어 넣기
# 실행: powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1   (둘 다 지우기: -Remove)
param([switch]$Remove, [string]$At = "09:10", [string]$WordsAt = "05:30")

$daily = "Wortling Daily"
$words = "Wortling Words"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command node).Source

if ($Remove) {
  foreach ($name in @($daily, $words)) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "removed: $name"
  }
  exit 0
}

$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\daily.mjs" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $daily -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "registered: $daily at $At ($root)"

# kaikki 원본(약 1GB) 받기 + claude 채우기(최대 1000단어)까지 고려해 3시간
$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\words\update.mjs" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $WordsAt
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $words -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "registered: $words every Sunday at $WordsAt ($root)"
