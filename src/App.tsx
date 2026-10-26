// 앱 틀: 접속 키 → 설정 불러오기 → 해시 경로별 화면 + 아래 탭
import { useEffect, useState } from 'react'
import { BottomNavigation, BottomNavigationItem, Button, Skeleton, TextField } from '@montage-ui/core'
import { IconBook, IconBookFill, IconCalendar, IconCalendarFill, IconHome, IconHomeFill } from '@montage-ui/icon'
import type { Settings } from '../shared/api.ts'
import { ApiError, MOCK, api, errorText, getToken, prefetchToday, retryUnsent, setToken, setUnauthorizedHandler } from './api.ts'
import { navigate, useRoute } from './router.ts'
import Artikel from './screens/Artikel.tsx'
import Deck from './screens/Deck.tsx'
import Drill from './screens/Drill.tsx'
import Inbox from './screens/Inbox.tsx'
import Onboarding from './screens/Onboarding.tsx'
import Practice from './screens/Practice.tsx'
import SettingsScreen from './screens/Settings.tsx'
import Setup from './screens/Setup.tsx'
import Stats from './screens/Stats.tsx'
import Changes from './screens/Changes.tsx'
import Today from './screens/Today.tsx'
import WordDetail from './screens/WordDetail.tsx'
import Words from './screens/Words.tsx'
import { Emoji, ErrorBox, Top, useToaster } from './ui.tsx'

const TABS = [
  { value: 'today', label: '오늘', icon: IconHome, on: IconHomeFill },
  { value: 'words', label: '단어', icon: IconBook, on: IconBookFill },
  { value: 'stats', label: '기록', icon: IconCalendar, on: IconCalendarFill },
]

export default function App() {
  const route = useRoute()
  const toast = useToaster()
  const [needKey, setNeedKey] = useState(() => !MOCK && !getToken())
  const [wrongKey, setWrongKey] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [bootError, setBootError] = useState<string>()
  const [boot, setBoot] = useState(0)

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setWrongKey(getToken() !== '')
      setNeedKey(true)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  useEffect(() => {
    if (needKey) return
    let live = true
    setBootError(undefined)
    // 못 보낸 채점을 먼저 보내고(오늘 덱 요청이 그 전송을 기다림) 오늘 화면이면 덱을 설정과 동시에 받는다
    const unsent = retryUnsent()
    if (!MOCK && ['today', 'deck'].includes(route.parts[0] ?? 'today')) prefetchToday()
    api.settings().then(
      (s) => {
        if (!live) return
        setSettings(s)
        unsent.then((n) => live && n > 0 && toast(`지난번에 못 보낸 채점 ${n}개를 보냈어요`, 'positive'))
      },
      (e) => live && !(e instanceof ApiError && e.status === 401) && setBootError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [needKey, boot, toast])

  const page = route.parts[0] ?? 'today'
  // 처음 온 사람은 시작하기로
  useEffect(() => {
    if (settings && !settings.onboarded && page !== 'onboarding' && page !== 'setup') navigate('/onboarding', true)
  }, [settings, page])

  // 알림 링크(…?n=알림번호)로 열었으면 열림을 한 번 적고(A4) 주소에서 n 을 지운다.
  // 알림 링크는 오늘 · 덱으로만 온다 — 추가 연습 · 더 공부하기의 n(문제 수)을 알림 번호로 읽지 않게
  const openedN = page === 'today' || page === 'deck' ? route.query.get('n') : null
  useEffect(() => {
    if (!settings || !openedN || !/^\d+$/.test(openedN)) return
    api.markOpened(Number(openedN)).catch(() => undefined)
    const q = new URLSearchParams(route.query)
    q.delete('n')
    navigate(route.path + (q.toString() ? '?' + q.toString() : ''), true)
  }, [settings, openedN, route.path, route.query])

  const save = async (patch: Partial<Settings>) => {
    const prev = settings
    setSettings((s) => s && { ...s, ...patch })
    try {
      // 서버 응답으로 덮지 않는다: 빠르게 여러 번 누르면 응답 순서가 뒤바뀔 수 있다
      await api.saveSettings(patch)
    } catch (e) {
      setSettings(prev)
      toast(`저장 못 했어요 · ${errorText(e)}`, 'negative')
    }
  }

  if (needKey)
    return (
      <div className="app">
        <KeyEntry
          wrong={wrongKey}
          onDone={() => {
            setNeedKey(false)
            setBoot((b) => b + 1)
          }}
        />
      </div>
    )

  if (!settings)
    return (
      <div className="app">
        <Top title="Wortling" />
        <main className="page">
          {bootError ? (
            <ErrorBox error={bootError} onRetry={() => setBoot((b) => b + 1)} />
          ) : (
            <Skeleton variant="rectangle" width="100%" height={420} radius={20} />
          )}
        </main>
      </div>
    )

  let screen
  switch (page) {
    case 'onboarding':
      screen = (
        <Onboarding
          settings={settings}
          onDone={async (p) => {
            await save(p)
            navigate('/today', true)
          }}
        />
      )
      break
    case 'words':
      screen = <Words add={route.query.get('add') ?? ''} url={route.query.get('url') ?? ''} open={route.query.get('open') === '1'} />
      break
    case 'changes':
      screen = <Changes />
      break
    case 'word':
      screen = <WordDetail id={route.parts[1] ?? ''} />
      break
    case 'stats':
      screen = <Stats />
      break
    case 'inbox':
      screen = <Inbox />
      break
    case 'settings':
      screen = <SettingsScreen settings={settings} onChange={save} />
      break
    case 'setup':
      screen = <Setup />
      break
    case 'drill':
      screen = <Drill mode={settings.swipe_mode} />
      break
    case 'artikel':
      screen = <Artikel />
      break
    case 'deck':
      screen = <Deck onSettings={save} />
      break
    case 'practice':
      screen = <Practice />
      break
    default:
      screen = <Today onSettings={save} />
  }
  const tab = page === 'word' ? 'words' : TABS.some((t) => t.value === page) ? page : ['onboarding', 'inbox', 'settings', 'setup', 'changes'].includes(page) ? '' : 'today'

  return (
    <div className="app">
      {screen}
      {page !== 'onboarding' && (
        <nav className="tabbar" aria-label="아래 탭">
          <BottomNavigation value={tab} onValueChange={(v) => '/' + v !== route.path && navigate('/' + v)}>
            {TABS.map(({ value, label, icon: I, on: On }) => (
              <BottomNavigationItem key={value} value={value} label={label} icon={tab === value ? <On /> : <I />} />
            ))}
          </BottomNavigation>
        </nav>
      )}
    </div>
  )
}

/** 401 이거나 키가 없을 때. 주소에 ?k= 를 붙여 열어도 된다. */
function KeyEntry({ wrong, onDone }: { wrong: boolean; onDone: () => void }) {
  const [key, setKey] = useState('')
  return (
    <>
      <Top title="접속 키" />
      <main className="page bare">
        <Emoji name="hello" size={96} className="hero" />
        <h1>Wortling</h1>
        <p className="lead">
          혼자 쓰는 앱이라 열쇠가 있어야 열려요. 키를 외울 필요는 없어요.
        </p>
        <ul className="lead">
          <li>PC: 바탕화면의 「Wortling 설정.html」 을 더블클릭하면 바로 들어가요.</li>
          <li>폰: 그 설정 화면에 나오는 QR 을 폰 카메라로 찍으면 바로 들어가요.</li>
        </ul>
        <p className="small">키를 직접 넣으려면 아래 칸에 붙여 넣으세요(PC 의 wortling 폴더 .env 파일, API_TOKEN= 뒤 값).</p>
        <form
          className="keyform"
          onSubmit={(e) => {
            e.preventDefault()
            if (!key.trim()) return
            setToken(key)
            onDone()
          }}
        >
          {wrong && !key && <p className="small bad">저장된 키가 맞지 않아요. 다시 넣어 주세요.</p>}
          <TextField
            status={wrong && !key ? 'negative' : 'normal'}
            type="password"
            autoComplete="current-password"
            placeholder="접속 키"
            aria-label="접속 키"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button type="submit" fullWidth size="large" disabled={!key.trim()}>
            들어가기
          </Button>
        </form>
      </main>
    </>
  )
}
