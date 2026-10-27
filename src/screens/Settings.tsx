// 설정: 고치면 바로 저장(PUT /api/settings)
import { useEffect, useState } from 'react'
import { Button, SegmentedControl, SegmentedControlItem, Switch } from '@montage-ui/core'
import { IconChevronRight, IconSend } from '@montage-ui/icon'
import type { Settings } from '../../shared/api.ts'
import { MOCK, api, errorText, getToken, setToken, type TestNotificationResponse } from '../api.ts'
import { fmtDay, studyDay } from '../format.ts'
import { disablePush, enablePush, pushSupported, pushSync } from '../push.ts'
import { linkTo } from '../router.ts'
import { LEVELS, LEVEL_HINT, Stepper, Top, useToaster } from '../ui.tsx'

/** 시험 통 결과를 채널별로: 「디스코드 ○ · 기기 1대 ○」 */
function channelsText({ discord, push }: Required<Pick<TestNotificationResponse, 'discord' | 'push'>>) {
  const d = discord.ok ? '○' : discord.error === 'no_webhook' ? '없음' : discord.error === 'off' ? '꺼 둠' : '×'
  const p = push.sent ? `${push.sent}대 ○` : push.error === 'no_subscription' ? '없음' : '×'
  return `디스코드 ${d} · 기기 ${p}`
}

/** 시험 통 보내기 → 토스트. 온보딩과 같이 쓴다. */
export function useTestNotification() {
  const toast = useToaster()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const r = await api.testNotification()
      if (r.error === 'no_channel')
        toast('아직 받을 곳이 없어요. 디스코드 웹후크를 넣거나 「이 기기로 받기」를 켜 주세요.', 'cautionary')
      else if (r.discord && r.push) {
        const partial =
          (!r.discord.ok && r.discord.error !== 'no_webhook' && r.discord.error !== 'off') || (!r.push.ok && r.push.error !== 'no_subscription')
        toast(channelsText({ discord: r.discord, push: r.push }), !r.ok ? 'negative' : partial ? 'cautionary' : 'positive')
      } else toast(`보내기 실패 · ${r.error ?? r.status ?? ''}`, 'negative')
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

export default function SettingsScreen({ settings, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const test = useTestNotification()
  const today = studyDay()
  const away = settings.vacation_until !== '' && settings.vacation_until >= today
  const token = getToken()
  const plusDays = (n: number) => studyDay(new Date(Date.now() + n * 86_400_000))

  return (
    <>
      <Top title="설정" back="/today" />
      <main className="page">
        <a className="box wh linkrow" {...linkTo('/setup')}>
          <span>
            연결 설정(폰 · 디스코드)
            <small className="sub">QR 로 폰에서 열기 · 디스코드 웹후크 넣기</small>
          </span>
          <IconChevronRight aria-hidden />
        </a>
        <a className="box wh linkrow" {...linkTo('/changes')}>
          <span>
            고친 카드
            <small className="sub">매일 새벽 검토가 바꾼 뜻·예문 · 되돌리기</small>
          </span>
          <IconChevronRight aria-hidden />
        </a>
        <h3 className="sec-t">공부</h3>
        <div className="box wh">
          <div className="kv">
            <span>하루 새 단어</span>
            <Stepper label="하루 새 단어" value={settings.new_per_day} min={3} max={50} onChange={(v) => onChange({ new_per_day: v })} />
          </div>
          <div className="kv col">
            <span>
              레벨
              <small className="sub">{LEVEL_HINT}</small>
            </span>
            <SegmentedControl size="small" value={settings.level} onValueChange={(v) => onChange({ level: v as Settings['level'] })}>
              {LEVELS.map((lv) => (
                <SegmentedControlItem key={lv} value={lv}>{lv}</SegmentedControlItem>
              ))}
            </SegmentedControl>
          </div>
          <div className="kv col">
            <span>카드 밀기</span>
            <SegmentedControl size="small" value={String(settings.swipe_mode)} onValueChange={(v) => onChange({ swipe_mode: v === '2' ? 2 : 4 })}>
              <SegmentedControlItem value="4">4방향</SegmentedControlItem>
              <SegmentedControlItem value="2">2방향(← →)</SegmentedControlItem>
            </SegmentedControl>
          </div>
        </div>

        <h3 className="sec-t">알림</h3>
        <div className="box wh">
          <div className="kv"><span>아침 카드</span><b>07:30</b></div>
          <div className="kv col">
            <span>
              저녁 알림 21:00
              <small className="sub">
                {settings.evening_mode === 'none_today'
                  ? `오늘 한 장도 안 했고 오늘 몫이 ${settings.evening_min}장 이상 남았을 때만 · 폰 알림에 「1시간 뒤」`
                  : `오늘 몫이 ${settings.evening_min}장 이상 남았으면 · 오늘 몫을 다 했으면 안 와요 · 폰 알림에 「1시간 뒤」`}
              </small>
            </span>
            <SegmentedControl
              size="small"
              value={settings.evening_mode}
              onValueChange={(v) => onChange({ evening_mode: v === 'any_left' ? 'any_left' : 'none_today' })}
            >
              <SegmentedControlItem value="none_today">오늘 0장일 때만</SegmentedControlItem>
              <SegmentedControlItem value="any_left">오늘 몫 남으면</SegmentedControlItem>
            </SegmentedControl>
          </div>
          <div className="kv">
            <span>저녁 알림 최소 남은 카드</span>
            <Stepper label="저녁 알림 최소 남은 카드" value={settings.evening_min} min={1} max={30} onChange={(v) => onChange({ evening_min: v })} />
          </div>
          <div className="kv">
            <span>
              휴가 모드
              <small className="sub">{away ? `${fmtDay(settings.vacation_until)}까지 알림을 쉬어요` : '켜면 그날까지 알림을 보내지 않아요'}</small>
            </span>
            <Switch
              aria-label="휴가 모드"
              checked={away}
              onCheckedChange={(on) => onChange({ vacation_until: on ? plusDays(7) : '' })}
            />
          </div>
          {away && (
            <div className="kv">
              <label htmlFor="vac">마지막 날</label>
              <input
                id="vac"
                className="date"
                type="date"
                min={today}
                value={settings.vacation_until}
                onChange={(e) => e.target.value && onChange({ vacation_until: e.target.value })}
              />
            </div>
          )}
          {!MOCK && <PushRow discordOn={settings.discord_on} onDiscordOff={() => onChange({ discord_on: false })} />}
          <div className="kv">
            <span>
              디스코드로도 받기
              <small className="sub">
                {settings.discord_on ? '기기 알림과 함께 디스코드로도 와요' : '기기로 못 받을 때만 디스코드로 와요'}
              </small>
            </span>
            <Switch aria-label="디스코드로도 받기" checked={settings.discord_on} onCheckedChange={(on) => onChange({ discord_on: on })} />
          </div>
          <div className="kv">
            <span>디스코드 · 기기</span>
            <Button variant="outlined" color="assistive" size="small" loading={test.busy} leadingContent={<IconSend />} onClick={test.run}>
              시험 통
            </Button>
          </div>
        </div>

        <h3 className="sec-t">접속</h3>
        <div className="box wh">
          <div className="kv">
            <span>접속 키</span>
            <span className="row-g">
              <b className="num">{MOCK ? '목업' : token ? '••••' + token.slice(-4) : '없음'}</b>
              {!MOCK && (
                <Button
                  variant="outlined"
                  color="assistive"
                  size="small"
                  onClick={() => {
                    setToken('')
                    location.reload()
                  }}
                >
                  바꾸기
                </Button>
              )}
            </span>
          </div>
          <div className="kv"><span>앱 주소</span><b className="url">{location.host}</b></div>
          <div className="kv"><span>버전</span><b className="num">{__APP_VERSION__}</b></div>
        </div>
      </main>
    </>
  )
}

/**
 * 이 기기로 받기(웹 푸시). 못 받는 브라우저면 그 한 줄, 권한이 막혔으면 그 사실을 한 줄로.
 * 켜면 디스코드 알림을 끈다(같은 알림이 두 번 오지 않게, 2026-10-27 사용자 지시) — 기기로 못 받으면 서버가 디스코드로 보낸다.
 */
function PushRow({ discordOn, onDiscordOff }: { discordOn: boolean; onDiscordOff: () => void }) {
  const toast = useToaster()
  const supported = pushSupported()
  const [on, setOn] = useState<boolean | null>(null) // null = 확인 중
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (supported) pushSync().then(setOn, () => setOn(false))
  }, [supported])

  if (!supported)
    return (
      <div className="kv">
        <span>
          이 기기로 받기
          <small className="sub">이 브라우저는 알림을 못 받아요</small>
        </span>
      </div>
    )
  const denied = Notification.permission === 'denied'
  const toggle = async (next: boolean) => {
    setBusy(true)
    try {
      await (next ? enablePush() : disablePush())
      setOn(next)
      if (next && discordOn) onDiscordOff()
      toast(next ? (discordOn ? '이 기기로 알림이 와요 · 디스코드 알림은 껐어요' : '이 기기로 알림이 와요') : '이 기기 알림을 껐어요', 'positive')
    } catch (e) {
      toast(e instanceof Error && e.message === 'denied' ? '알림 권한을 받지 못했어요' : errorText(e), 'negative')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="kv">
      <span>
        이 기기로 받기
        <small className="sub">
          {denied ? '알림이 막혀 있어요. 브라우저 설정에서 이 사이트 알림을 허용해 주세요.' : on ? '이 기기로 알림이 와요' : '켜면 이 기기로 알림이 오고 디스코드 알림은 꺼져요'}
        </small>
      </span>
      <Switch aria-label="이 기기로 받기" checked={Boolean(on)} disabled={on === null || busy || (denied && !on)} onCheckedChange={toggle} />
    </div>
  )
}
