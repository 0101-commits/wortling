// 오늘 몫 덱(기획 v8): 오늘 화면의 「시작 · 이어서」와 알림 링크(?first=)로 들어온다.
// 채점은 쌓았다가 판 끝(또는 탭을 떠날 때) 한 번에 보낸다. 판이 끝나면 오늘 화면으로 돌아가 결과를 보여 준다.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Skeleton } from '@montage-ui/core'
import { IconFlipBackward } from '@montage-ui/icon'
import type { Settings, TodayResponse } from '../../shared/api.ts'
import { api, errorText, sendReviews } from '../api.ts'
import { buildSession, deckReducer, initDeck } from '../deck.ts'
import { useAsync } from '../hooks.ts'
import { navigate, useRoute } from '../router.ts'
import { ReportButton } from '../Report.tsx'
import { SwipeDeck } from '../SwipeDeck.tsx'
import { ErrorBox, Top, useToaster } from '../ui.tsx'

export default function Deck({ onSettings }: { onSettings: (p: Partial<Settings>) => Promise<void> }) {
  const today = useAsync(() => api.today(), [])
  // 오늘은 복습만(B6): 이 학습일만 새 카드 0. 다음 학습일엔 저절로 풀린다
  const setReviewOnly = async (on: boolean) => {
    if (!today.data) return
    await onSettings({ review_only_day: on ? today.data.date : '' })
    today.reload()
  }
  // 아침 알림 빈칸 문제의 정답 카드(?first=w0002)를 덱 맨 앞으로(A1)
  const first = useRoute().query.get('first')
  return (
    <>
      <Top title="오늘 몫" back="/today" />
      <main className="page deck-page">
        {today.data ? (
          <Session
            key={today.data.date + today.data.settings.review_only_day + (first ?? '')}
            data={today.data}
            first={first}
            onReviewOnly={setReviewOnly}
          />
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

function Session({ data, first, onReviewOnly }: { data: TodayResponse; first: string | null; onReviewOnly: (on: boolean) => void }) {
  const reviewOnly = data.settings.review_only_day === data.date
  const toast = useToaster()
  const [s, dispatch] = useReducer(deckReducer, data, (d) => initDeck(buildSession(d, first), 1, d.day_end))
  const [sid] = useState(() => Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
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

  // 판 끝 → 한 번 전송 → 오늘 화면(결과 · 더 공부하기). 오늘 화면은 전송이 끝난 뒤 오늘 몫을 다시 받는다(api.ts inflight)
  useEffect(() => {
    if (!s.finished) return
    const p = flush(false)
    if (!p) {
      navigate('/today', true)
      return
    }
    p.catch((e) => toast(`채점을 못 보냈어요(${errorText(e)}). 기기에 적어 두고 다음에 열 때 다시 보내요.`, 'negative')).finally(() =>
      navigate('/today', true),
    )
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

  if (s.finished) return <Skeleton variant="rectangle" width="100%" height={420} radius={20} />

  const cards = s.queue.slice(s.index, s.index + 3).map((item, k) => ({ key: String(s.index + k), item }))
  return (
    <>
      <div className="tophint">
        <button type="button" className="undo" disabled={!s.history} onClick={() => dispatch({ type: 'undo' })}>
          <IconFlipBackward aria-hidden /> 되돌리기
        </button>
        <span className="mix">
          새 {mix.fresh} · 복습 {mix.review}
          {/* 덱을 시작하기 전에만: 새 카드를 오늘 빼거나 되돌림 */}
          {s.index === 0 && (mix.fresh > 0 || reviewOnly) && (
            <button type="button" className={'revonly' + (reviewOnly ? ' on' : '')} aria-pressed={reviewOnly} onClick={() => onReviewOnly(!reviewOnly)}>
              {reviewOnly ? '복습만 · 끄기' : '오늘은 복습만'}
            </button>
          )}
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
      {/* 윗줄(되돌리기 · 새/복습 · 진행 수)은 390px 에서 꽉 차 두 줄로 꺾였다 → 덱 아래 오른쪽에 */}
      {s.queue[s.index] && (
        <div className="report-row">
          <ReportButton key={s.queue[s.index].word.id} wordId={s.queue[s.index].word.id} lemma={s.queue[s.index].word.lemma} />
        </div>
      )}
    </>
  )
}
