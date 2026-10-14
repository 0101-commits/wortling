// 오늘 = 덱. 채점은 쌓았다가 세션 끝(또는 탭을 떠날 때) 한 번에 보낸다.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Button, Skeleton } from '@montage-ui/core'
import { IconFlipBackward } from '@montage-ui/icon'
import type { TodayResponse } from '../../shared/api.ts'
import { api, errorText, sendReviews } from '../api.ts'
import { buildSession, deckReducer, firstUp, initDeck } from '../deck.ts'
import { fmtDay } from '../format.ts'
import { useAsync } from '../hooks.ts'
import { navigate } from '../router.ts'
import { SwipeDeck } from '../SwipeDeck.tsx'
import { CountUp, Emoji, ErrorBox, Top, useToaster } from '../ui.tsx'

export default function Today() {
  const today = useAsync(() => api.today(), [])
  // 아침 알림 빈칸 문제의 정답 카드(?first=w0002)를 덱 맨 앞으로(A1). 처음 연 순간의 값만 쓴다
  const [first] = useState(readFirst)
  return (
    <>
      <Top title="오늘" actions />
      <main className="page deck-page">
        {today.data ? (
          <Session key={today.data.date} data={today.data} first={first} />
        ) : today.error ? (
          <ErrorBox error={today.error} onRetry={today.reload} />
        ) : (
          <>
            <Skeleton variant="text" width="40%" height={20} />
            <Skeleton variant="rectangle" width="100%" height={420} radius={20} />
          </>
        )}
      </main>
    </>
  )
}

/** 주소의 ?first= (첫 렌더에서 한 번 읽음) */
function readFirst(): string | null {
  return new URLSearchParams(location.hash.split('?')[1] ?? '').get('first')
}

function Session({ data, first }: { data: TodayResponse; first: string | null }) {
  const toast = useToaster()
  const [s, dispatch] = useReducer(deckReducer, data, (d) => initDeck(firstUp(buildSession(d), first)))
  const [sid] = useState(() => Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
  const [tomorrow, setTomorrow] = useState<number | null>(null)
  const [mix] = useState(() => {
    const fresh = s.queue.filter((it) => it.card.state === 0).length
    return { fresh, review: s.queue.length - fresh }
  })

  // 보내기: 아직 안 보낸 채점만. 이벤트 처리기에서 최신 상태를 읽으려고 ref 에 둔다.
  const latest = useRef(s)
  useEffect(() => {
    latest.current = s
  }, [s])
  const flush = useCallback(
    (keepalive: boolean) => {
      const st = latest.current
      const reviews = st.pending.slice(st.sentCount)
      if (!reviews.length) return null
      latest.current = { ...st, sentCount: st.pending.length }
      dispatch({ type: 'flush' })
      return sendReviews({ session_id: sid, reviews }, keepalive)
    },
    [sid],
  )

  // 세션 끝 → 한 번 전송 → 내일 예정 수
  useEffect(() => {
    if (!s.finished) return
    const p = flush(false)
    if (!p) return
    p.then(() => api.stats())
      .then((st) => setTomorrow(st.due_tomorrow))
      .catch((e) => toast(`채점을 못 보냈어요(${errorText(e)}). 기기에 적어 두고 다음에 열 때 다시 보내요.`, 'negative'))
  }, [s.finished, flush, toast])

  // 앱을 내리거나 다른 탭으로 가면 그때까지의 채점을 보낸다
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush(true)?.catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flush(false)?.catch(() => undefined)
    }
  }, [flush])

  if (s.queue.length === 0) return <Rest vacation={data.settings.vacation_until} date={data.date} />

  if (s.finished) {
    const good = s.pending.filter((p) => p.rating >= 3).length
    return (
      <section className="done">
        <Emoji name="happy" size={112} />
        <h1>오늘 끝</h1>
        <p className="tomorrow">
          내일 {tomorrow === null ? <span className="num">…</span> : <CountUp value={tomorrow} />}장
        </p>
        <div className="bento">
          <div className="b">
            <div className="v num">{good}</div>
            <div className="l">좋음 · 쉬움</div>
          </div>
          <div className="b">
            <div className="v num">{s.pending.length - good}</div>
            <div className="l">다시 · 어려움</div>
          </div>
          <div className="b wide">
            <div className="v num">
              {s.pending.length}
              <small>번</small>
            </div>
            <div className="l">오늘 채점 · 카드 {new Set(s.pending.map((p) => p.word_id)).size}장</div>
          </div>
        </div>
        <Button fullWidth size="large" onClick={() => navigate('/words')}>
          단어 보기
        </Button>
      </section>
    )
  }

  const cards = s.queue.slice(s.index, s.index + 3).map((item, k) => ({ key: String(s.index + k), item }))
  return (
    <>
      <div className="tophint">
        <button type="button" className="undo" disabled={!s.history} onClick={() => dispatch({ type: 'undo' })}>
          <IconFlipBackward aria-hidden /> 되돌리기
        </button>
        <span className="mix">
          새 {mix.fresh} · 복습 {mix.review}
        </span>
        <span className="counter num" data-testid="progress" aria-live="polite">
          {s.index + 1} / {s.queue.length}
        </span>
      </div>
      <SwipeDeck
        cards={cards}
        mode={data.settings.swipe_mode}
        onGrade={(rating) => dispatch({ type: 'grade', rating, at: new Date().toISOString() })}
        onUndo={() => dispatch({ type: 'undo' })}
      />
    </>
  )
}

function Rest({ vacation, date }: { vacation: string; date: string }) {
  const away = vacation && vacation >= date
  return (
    <section className="empty">
      <Emoji name="sleep" size={160} />
      <h2>오늘은 쉬어도 돼요</h2>
      <p>{away ? `휴가 모드 · ${fmtDay(vacation)}까지 알림을 쉬어요.` : '복습할 카드도 새 단어도 없어요.'}</p>
      <Button variant="outlined" color="assistive" onClick={() => navigate('/words')}>
        단어 보기
      </Button>
    </section>
  )
}
