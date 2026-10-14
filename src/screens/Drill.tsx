// 추가 연습(B4): 오늘 몫 뒤 「범위 × 분량」, 또는 단어 목록에서 「이 목록으로 연습」.
// 한 판 안에서만 돈다 — 다시·어려움은 줄 뒤로, 좋음·쉬움은 빼기. 서버에 채점을 보내지 않아 일정(FSRS)은 그대로(D5, G17).
import { useReducer } from 'react'
import { Button, Skeleton } from '@montage-ui/core'
import type { DeckItem, DrillScope, Settings, WordsQuery } from '../../shared/api.ts'
import { api } from '../api.ts'
import { deckReducer, initDeck, shuffle } from '../deck.ts'
import { useAsync } from '../hooks.ts'
import { navigate, useRoute } from '../router.ts'
import { SwipeDeck } from '../SwipeDeck.tsx'
import { Emoji, ErrorBox, Top } from '../ui.tsx'

export const SCOPE_LABEL: Record<DrillScope, string> = { today: '오늘 본 단어', week: '최근 7일', all: '배운 단어 전체' }
const SIZES = [10, 30, 50]

/** 주소 → 불러오기. from=words 면 단어 목록과 같은 거르기·정렬 앞에서 n장 */
async function load(q: URLSearchParams): Promise<{ title: string; items: DeckItem[] }> {
  const n = SIZES.includes(Number(q.get('n'))) ? Number(q.get('n')) : 10
  if (q.get('from') === 'words') {
    const w: WordsQuery = {
      q: q.get('q') || undefined,
      level: (q.get('level') as WordsQuery['level']) || undefined,
      state: (q.get('state') as WordsQuery['state']) || undefined,
      sort: (q.get('sort') as WordsQuery['sort']) || undefined,
      page: 1,
      size: n,
    }
    return { title: '목록 연습', items: (await api.words(w)).items }
  }
  const scope = (['today', 'week', 'all'] as const).find((s) => s === q.get('scope')) ?? 'today'
  return { title: SCOPE_LABEL[scope], items: (await api.drill(scope, n)).items }
}

export default function Drill({ mode }: { mode: Settings['swipe_mode'] }) {
  const route = useRoute()
  const key = route.query.toString()
  const r = useAsync(() => load(route.query), [key])
  return (
    <>
      <Top title={r.data ? `추가 연습 · ${r.data.title}` : '추가 연습'} back="/today" />
      <main className="page deck-page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !r.data ? (
          <Skeleton variant="rectangle" width="100%" height={420} radius={20} />
        ) : r.data.items.length === 0 ? (
          <section className="empty">
            <Emoji name="think" size={140} />
            <h2>이 범위에는 아직 배운 단어가 없어요</h2>
            <p>범위를 넓히거나 오늘 카드를 먼저 해 보세요.</p>
            <Button variant="outlined" color="assistive" onClick={() => navigate('/today')}>
              오늘로
            </Button>
          </section>
        ) : (
          <Run key={key + ':' + r.data.items.length} items={r.data.items} mode={mode} onAgain={r.reload} />
        )}
      </main>
    </>
  )
}

function Run({ items, mode, onAgain }: { items: DeckItem[]; mode: Settings['swipe_mode']; onAgain: () => void }) {
  // 다시·어려움(≤2)은 줄 뒤로 — 오늘 덱(다시만)보다 한 단계 넓게
  const [s, dispatch] = useReducer(deckReducer, items, (it) => initDeck(shuffle(it), 2))
  if (s.finished) {
    const cards = new Set(s.pending.map((p) => p.word_id)).size
    const again = s.pending.length - cards
    return (
      <section className="done">
        <Emoji name="party" size={112} />
        <h1>연습 끝</h1>
        <p className="tomorrow">
          {cards}장 · 다시 본 카드 {again}번
        </p>
        <p className="small muted center">일정은 바뀌지 않았어요. 복습 날짜는 오늘 덱 그대로예요.</p>
        <Button fullWidth size="large" onClick={onAgain}>
          한 판 더
        </Button>
        <Button fullWidth size="large" variant="outlined" color="assistive" onClick={() => navigate('/today')}>
          오늘로
        </Button>
      </section>
    )
  }
  const cards = s.queue.slice(s.index, s.index + 3).map((item, k) => ({ key: String(s.index + k), item }))
  return (
    <>
      <div className="tophint">
        <span className="mix">모르면 줄 뒤로 · 일정은 그대로</span>
        <span className="counter num" data-testid="progress" aria-live="polite">
          {s.index + 1} / {s.queue.length}
        </span>
      </div>
      <SwipeDeck
        cards={cards}
        mode={mode}
        hint="drill"
        onGrade={(rating) => dispatch({ type: 'grade', rating, at: new Date().toISOString() })}
        onUndo={() => dispatch({ type: 'undo' })}
      />
    </>
  )
}
