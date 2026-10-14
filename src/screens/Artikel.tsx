// 관사 1분(B5): der · die · das 만 빠르게. 1분 또는 20문제. 틀린 단어는 끝에 모아 보여 준다.
// 일정(FSRS)은 안 바꾼다(D5). 순위표 없음(개인용).
import { useEffect, useState } from 'react'
import { Button, Skeleton } from '@montage-ui/core'
import type { DeckItem } from '../../shared/api.ts'
import { api } from '../api.ts'
import { shuffle } from '../deck.ts'
import { useAsync } from '../hooks.ts'
import { linkTo, navigate } from '../router.ts'
import { Emoji, ErrorBox, Top } from '../ui.tsx'

const COUNT = 20
const SECONDS = 60
const ARTS = ['der', 'die', 'das'] as const
type Art = (typeof ARTS)[number]

export default function Artikel() {
  const [round, setRound] = useState(0)
  const r = useAsync(() => api.artikel(COUNT), [round])
  return (
    <>
      <Top title="관사 1분" back="/today" />
      <main className="page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !r.data ? (
          <Skeleton variant="rectangle" width="100%" height={320} radius={20} />
        ) : r.data.items.length === 0 ? (
          <section className="empty">
            <Emoji name="think" size={140} />
            <h2>물어볼 명사가 없어요</h2>
          </section>
        ) : (
          <Game key={round} items={r.data.items} onAgain={() => setRound((n) => n + 1)} />
        )}
      </main>
    </>
  )
}

function Game({ items, onAgain }: { items: DeckItem[]; onAgain: () => void }) {
  const [list] = useState(() => shuffle(items))
  const [i, setI] = useState(0)
  const [left, setLeft] = useState(SECONDS)
  const [right, setRight] = useState(0)
  const [wrong, setWrong] = useState<DeckItem[]>([])
  const [flash, setFlash] = useState<{ pick: Art; ok: boolean } | null>(null)
  const over = left <= 0 || i >= list.length

  // 1초 시계 — 끝나면 멈춤
  useEffect(() => {
    if (over) return
    const t = setInterval(() => setLeft((s) => s - 1), 1000)
    return () => clearInterval(t)
  }, [over])

  const answer = (pick: Art) => {
    if (over || flash) return
    const it = list[i]
    const ok = it.word.gender === pick
    setFlash({ pick, ok })
    if (ok) setRight((n) => n + 1)
    else setWrong((w) => [...w, it])
    // 맞으면 바로, 틀리면 정답 색을 잠깐 보여 주고 다음
    setTimeout(() => {
      setFlash(null)
      setI((n) => n + 1)
    }, ok ? 250 : 700)
  }

  // 키보드 1 · 2 · 3
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = Number(e.key)
      if (k >= 1 && k <= 3) answer(ARTS[k - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (over) {
    const asked = Math.min(i, list.length)
    return (
      <section className="done">
        <Emoji name={right >= asked * 0.8 ? 'party' : 'study'} size={112} />
        <h1>
          {asked}문제 중 {right}개
        </h1>
        {wrong.length > 0 ? (
          <div className="box wh art-wrong">
            <p className="small muted">헷갈린 관사</p>
            {wrong.map((it) => (
              <a key={it.word.id} className="kv" {...linkTo('/word/' + it.word.id)}>
                <span lang="de">
                  <b className={it.word.gender ?? ''}>{it.word.gender}</b> {it.word.lemma}
                </span>
                <span className="small muted">{it.word.gloss_ko}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="tomorrow">하나도 안 틀렸어요</p>
        )}
        <Button fullWidth size="large" onClick={onAgain}>
          한 판 더
        </Button>
        <Button fullWidth size="large" variant="outlined" color="assistive" onClick={() => navigate('/today')}>
          오늘로
        </Button>
      </section>
    )
  }

  const it = list[i]
  return (
    <section className="art-game">
      <div className="tophint">
        <span className="mix">
          {i + 1} / {list.length}
        </span>
        <span className={'counter num' + (left <= 10 ? ' warn' : '')} aria-live="off">
          0:{String(left).padStart(2, '0')}
        </span>
      </div>
      <div className="art-card box wh">
        <p className="art-q" lang="de">
          <span className={'art-blank' + (flash ? ' ' + (flash.ok ? 'ok' : 'no') + ' ' + it.word.gender : '')}>
            {flash ? it.word.gender : '___'}
          </span>{' '}
          {it.word.lemma}
        </p>
        <p className="small muted">{it.word.gloss_ko ?? ''}</p>
      </div>
      <div className="art-btns">
        {ARTS.map((a, k) => (
          <button key={a} type="button" className={'art-btn ' + a + (flash?.pick === a ? ' picked' : '')} onClick={() => answer(a)} aria-keyshortcuts={String(k + 1)}>
            {a}
          </button>
        ))}
      </div>
      <p className="small muted center">틀린 관사는 끝나고 다시 보여 줘요 · 키보드 1 2 3</p>
    </section>
  )
}
