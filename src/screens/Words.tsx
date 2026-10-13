// 단어 목록: 검색 · 칩 · 더 보기
import { useEffect, useState } from 'react'
import { Button, Chip, ContentBadge, SearchField, Skeleton } from '@montage-ui/core'
import type { DeckItem, WordsQuery } from '../../shared/api.ts'
import { api, errorText } from '../api.ts'
import { STATE_LABEL, dueText, num } from '../format.ts'
import { useDebounced } from '../hooks.ts'
import { linkTo } from '../router.ts'
import { ErrorBox, Lemma, Top, WordImage } from '../ui.tsx'

const CHIPS: Array<{ id: string; label: string; q: WordsQuery }> = [
  { id: 'all', label: '전체', q: {} },
  { id: 'new', label: '새 단어', q: { state: 'new' } },
  { id: 'learning', label: '학습 중', q: { state: 'learning' } },
  { id: 'review', label: '복습', q: { state: 'review' } },
  { id: 'B1', label: 'B1', q: { level: 'B1' } },
  { id: 'B2', label: 'B2', q: { level: 'B2' } },
]
const SIZE = 30
// 상세에 갔다 와도 검색어·칩을 기억한다
let remembered = { q: '', chip: 'all' }

export default function Words() {
  const [q, setQ] = useState(remembered.q)
  const [chip, setChip] = useState(remembered.chip)
  const dq = useDebounced(q.trim(), 250)
  const key = `${dq}|${chip}`
  const [pager, setPager] = useState({ key, page: 1 })
  const page = pager.key === key ? pager.page : 1
  const [list, setList] = useState<{ key: string; items: DeckItem[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    remembered = { q, chip }
  }, [q, chip])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(undefined)
    const query = CHIPS.find((c) => c.id === chip)?.q ?? {}
    api.words({ ...query, q: dq || undefined, page, size: SIZE }).then(
      (r) => {
        if (!live) return
        setList((prev) => ({
          key,
          total: r.total,
          items: page > 1 && prev?.key === key ? [...prev.items, ...r.items] : r.items,
        }))
        setLoading(false)
      },
      (e) => {
        if (!live) return
        setError(errorText(e))
        setLoading(false)
      },
    )
    return () => {
      live = false
    }
  }, [key, dq, chip, page, tick])

  const fresh = list?.key === key ? list : null // 칩·검색을 바꾼 직후엔 옛 목록을 감춘다
  const filtered = dq !== '' || chip !== 'all'

  return (
    <>
      <Top title="단어" actions />
      <main className="page">
        <SearchField
          size="medium"
          placeholder="단어 · 뜻 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onReset={() => setQ('')}
          aria-label="단어 검색"
        />
        <div className="chips" role="group" aria-label="거르기">
          {CHIPS.map((c) => (
            <Chip key={c.id} size="small" variant="outlined" active={chip === c.id} aria-pressed={chip === c.id} onClick={() => setChip(c.id)}>
              {c.label}
            </Chip>
          ))}
        </div>
        {fresh && <p className="small">{num(fresh.total)}개</p>}

        {error && !loading ? (
          <ErrorBox error={error} onRetry={() => setTick((t) => t + 1)} />
        ) : !fresh ? (
          <div className="list" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <div className="cell" key={i}>
                <Skeleton variant="rectangle" width={56} height={42} radius={10} />
                <div>
                  <Skeleton variant="text" width="60%" height={18} />
                  <Skeleton variant="text" width="40%" height={14} />
                </div>
                <Skeleton variant="text" width={40} height={14} />
              </div>
            ))}
          </div>
        ) : fresh.items.length === 0 ? (
          <div className="empty">
            <img src="/mascot/_default.webp" alt="" width={160} height={120} />
            <h2>{filtered ? '찾는 단어가 없어요' : '단어가 아직 없어요'}</h2>
            <p>{filtered ? '철자를 바꾸거나 다른 칩을 골라 보세요. 독일어·한국어·영어 뜻 모두 찾아요.' : '단어 시드를 넣으면 여기에 보여요.'}</p>
            {filtered && (
              <Button variant="outlined" color="assistive" size="small" onClick={() => { setQ(''); setChip('all') }}>
                검색 지우기
              </Button>
            )}
          </div>
        ) : (
          <>
            <ul className="list">
              {fresh.items.map((it) => (
                <li key={it.word.id}>
                  <a className="cell" {...linkTo('/word/' + it.word.id)}>
                    <div className="th">
                      <WordImage word={it.word} />
                    </div>
                    <div className="mid">
                      <Lemma word={it.word} className="w" />
                      <div className="m">{it.word.gloss_ko ?? it.word.gloss_en ?? '뜻 준비 중'}</div>
                    </div>
                    <div className="r">
                      <ContentBadge size="xsmall" variant="solid" color={it.card.state === 0 ? 'neutral' : 'accent'} accentColor="semantic.foreground.brand.primary">
                        {STATE_LABEL[it.card.state]}
                      </ContentBadge>
                      <span>{dueText(it)}</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
            {fresh.items.length < fresh.total && (
              <Button variant="outlined" color="assistive" fullWidth loading={loading} onClick={() => setPager({ key, page: page + 1 })}>
                더 보기 · {num(fresh.total - fresh.items.length)}개 남음
              </Button>
            )}
          </>
        )}
      </main>
    </>
  )
}
