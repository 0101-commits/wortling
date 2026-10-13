// 설정: 고치면 바로 저장(PUT /api/settings)
import { useState } from 'react'
import { Button, SegmentedControl, SegmentedControlItem, Switch } from '@montage-ui/core'
import { IconSend } from '@montage-ui/icon'
import type { Settings } from '../../shared/api.ts'
import { MOCK, api, errorText, getToken, setToken } from '../api.ts'
import { fmtDay, todayKst } from '../format.ts'
import { Stepper, Top, useToaster } from '../ui.tsx'

/** 시험 통 보내기 → 토스트. 온보딩과 같이 쓴다. */
export function useTestNotification() {
  const toast = useToaster()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const r = await api.testNotification()
      if (r.ok) toast('시험 통이 디스코드에 도착했어요', 'positive')
      else if (r.error?.includes('no_webhook'))
        toast('웹훅이 아직 없어요. Worker 비밀값 DISCORD_WEBHOOK 을 넣어 주세요.', 'cautionary')
      else toast(`보내기 실패 · ${r.error ?? r.status ?? ''}`, 'negative')
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
  const today = todayKst()
  const away = settings.vacation_until !== '' && settings.vacation_until >= today
  const token = getToken()
  const plusDays = (n: number) => todayKst(new Date(Date.now() + n * 86_400_000))

  return (
    <>
      <Top title="설정" back="/today" />
      <main className="page">
        <h3 className="sec-t">공부</h3>
        <div className="box wh">
          <div className="kv">
            <span>하루 새 단어</span>
            <Stepper label="하루 새 단어" value={settings.new_per_day} min={3} max={8} onChange={(v) => onChange({ new_per_day: v })} />
          </div>
          <div className="kv">
            <span>한 번에 볼 카드</span>
            <Stepper label="한 번에 볼 카드" value={settings.session_max} min={5} max={100} step={5} onChange={(v) => onChange({ session_max: v })} />
          </div>
          <div className="kv col">
            <span>레벨</span>
            <SegmentedControl size="small" value={settings.level} onValueChange={(v) => onChange({ level: v as Settings['level'] })}>
              <SegmentedControlItem value="B1">B1</SegmentedControlItem>
              <SegmentedControlItem value="B2">B2</SegmentedControlItem>
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
          <div className="kv"><span>저녁 남은 카드</span><b>21:00 · 있을 때만</b></div>
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
          <div className="kv">
            <span>디스코드</span>
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
