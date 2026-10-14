// 밀어서 채점하는 카드 묶음. 구조는 21st.dev swipe-deck(ddoemonn, MIT)를 참고해 다시 썼다(Tailwind 없음).
// ← 다시(1) · ↓ 어려움(2) · → 좋음(3) · ↑ 쉬움(4). swipe_mode 2 면 가로만.
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, type MotionValue } from 'motion/react'
import { ContentBadge } from '@montage-ui/core'
import type { DeckItem, Rating } from '../shared/api.ts'
import { RATING_LABEL, SWIPE, decideSwipe, intervals } from './deck.ts'
import { Emoji, Example, LevelBadge, Lemma, POS_LABEL, WordImage } from './ui.tsx'
import { seenLabel } from './format.ts'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface DeckCardRef {
  key: string
  item: DeckItem
}

interface Props {
  cards: DeckCardRef[] // [0] 이 맨 위, 최대 3장
  mode: 2 | 4
  onGrade: (r: Rating) => void
  onUndo: () => void
  /** 채점 칸의 「다음 복습까지」 글자. 추가 연습은 일정이 안 바뀌어 끈다 */
  hint?: 'interval' | 'drill'
}

/** 추가 연습(B4) 채점 칸 글자 — 일정 대신 한 판 안에서 일어나는 일 */
const DRILL_HINT: Record<Rating, string> = { 1: '줄 뒤로', 2: '줄 뒤로', 3: '빼기', 4: '빼기' }

export function SwipeDeck({ cards, mode, onGrade, onUndo, hint = 'interval' }: Props) {
  const top = cards[0]
  const stage = useRef<HTMLDivElement>(null)
  // 위 카드가 자기 함수를 여기에 걸어 둔다 → 채점 버튼·키보드가 같은 날아가기를 쓴다
  const ctl = useRef<TopControl | null>(null)

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const map: Record<string, Rating> = { ArrowLeft: 1, ArrowDown: 2, ArrowRight: 3, ArrowUp: 4 }
    if (map[e.key]) {
      e.preventDefault()
      ctl.current?.commit(map[e.key])
    } else if (e.key === ' ') {
      e.preventDefault()
      ctl.current?.flip()
    } else if (e.key === 'z' || e.key === 'Z') {
      if (!ctl.current?.busy()) onUndo()
    }
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const labels = !top ? null : hint === 'drill' ? DRILL_HINT : intervals(top.item.card)

  return (
    <>
      {/* 뒤 카드 크기·높이는 CSS 변수 --p(위 카드를 민 정도 0~1)와 --d(깊이)로만 정한다 */}
      <div className="stage" ref={stage} style={{ '--step': 1 - SWIPE.BACK_SCALE } as CSSProperties}>
        {cards
          .map((c, depth) => ({ c, depth }))
          .reverse()
          .map(({ c, depth }) =>
            depth === 0 ? (
              <TopCard key={c.key} item={c.item} mode={mode} stage={stage} ctl={ctl} onGrade={onGrade} />
            ) : (
              <div key={c.key} className="dk behind" aria-hidden style={{ '--d': depth, zIndex: 3 - depth } as CSSProperties}>
                <CardFace item={c.item} back={false} />
              </div>
            ),
          )}
      </div>
      <div className="grade" role="group" aria-label="채점">
        {([1, 2, 3, 4] as Rating[]).map((r) => (
          <button key={r} type="button" className={'r' + r} onClick={() => ctl.current?.commit(r)} disabled={!top}>
            <b>{RATING_LABEL[r]}</b>
            <small>{labels?.[r]}</small>
          </button>
        ))}
      </div>
      <p className="keys">← 다시 · ↓ 어려움 · → 좋음 · ↑ 쉬움 · Space 뒤집기 · Z 되돌리기</p>
    </>
  )
}

interface TopControl {
  commit: (r: Rating) => void
  flip: () => void
  busy: () => boolean
}

/** 맨 위 카드. 카드마다 새로 붙으므로(key) 이동·기울기·뒤집기 값이 다음 카드로 새지 않는다. */
function TopCard(props: {
  item: DeckItem
  mode: 2 | 4
  stage: RefObject<HTMLDivElement | null>
  ctl: RefObject<TopControl | null>
  onGrade: (r: Rating) => void
}) {
  const { item, mode, stage, ctl, onGrade } = props
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotate = useTransform(x, (v) => clamp(v / SWIPE.TILT_DIV, -SWIPE.TILT_MAX, SWIPE.TILT_MAX))
  const [flipped, setFlipped] = useState(false)
  const busy = useRef(false)
  const alive = useRef(false)
  const tap = useRef<{ t: number; x: number; y: number } | null>(null)

  const setProgress = () =>
    stage.current?.style.setProperty('--p', String(Math.min(1, Math.max(Math.abs(x.get()), Math.abs(y.get())) / SWIPE.COMMIT_X)))
  useMotionValueEvent(x, 'change', setProgress)
  useMotionValueEvent(y, 'change', setProgress)
  useLayoutEffect(() => {
    alive.current = true
    setProgress()
    return () => {
      alive.current = false // 날아가는 사이 되돌리기로 내려가면 채점하지 않는다
    }
  }, [])

  const commit = (r: Rating) => {
    if (busy.current) return
    busy.current = true
    const horizontal = r === 1 || r === 3
    const to = r === 3 || r === 2 ? SWIPE.EXIT_PX : -SWIPE.EXIT_PX
    animate(horizontal ? x : y, to, { duration: SWIPE.EXIT_MS / 1000, ease: 'easeIn' }).then(() => {
      if (alive.current) onGrade(r)
    })
  }
  useLayoutEffect(() => {
    ctl.current = { commit, flip: () => setFlipped((f) => !f), busy: () => busy.current }
  })

  return (
    <motion.div
      className="dk top"
      data-testid="deck-top"
      drag={mode === 4 ? true : 'x'}
      dragMomentum={false}
      style={{ x, y, rotate, zIndex: 3 }}
      onPointerDown={(e) => (tap.current = { t: e.timeStamp, x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const s = tap.current
        tap.current = null
        if (s && e.timeStamp - s.t < SWIPE.TAP_MS && Math.hypot(e.clientX - s.x, e.clientY - s.y) < SWIPE.TAP_PX) setFlipped((f) => !f)
      }}
      onDragEnd={(_, info) => {
        if (busy.current) return
        const r = decideSwipe(x.get(), y.get(), info.velocity.x / 1000, info.velocity.y / 1000, mode)
        if (r) return commit(r)
        const back = { duration: SWIPE.SNAP_MS / 1000, ease: 'easeOut' as const }
        animate(x, 0, back)
        animate(y, 0, back)
      }}
      role="button"
      tabIndex={0}
      aria-label={flipped ? '앞면 보기' : '뜻 보기'}
    >
      <Stamps x={x} y={y} />
      <CardFace item={item} back={flipped} />
    </motion.div>
  )
}

/** 미는 방향의 도장. 불투명도 = 이동 / 80 */
function Stamps({ x, y }: { x: MotionValue<number>; y: MotionValue<number> }) {
  const vertical = () => Math.abs(y.get()) > Math.abs(x.get()) * SWIPE.VERTICAL_RATIO
  const good = useTransform(() => (vertical() ? 0 : clamp(x.get() / SWIPE.STAMP_DIV, 0, 1)))
  const again = useTransform(() => (vertical() ? 0 : clamp(-x.get() / SWIPE.STAMP_DIV, 0, 1)))
  const easy = useTransform(() => (vertical() ? clamp(-y.get() / SWIPE.STAMP_DIV, 0, 1) : 0))
  const hard = useTransform(() => (vertical() ? clamp(y.get() / SWIPE.STAMP_DIV, 0, 1) : 0))
  return (
    <>
      <motion.span className="stp good" style={{ opacity: good }}>{RATING_LABEL[3]}</motion.span>
      <motion.span className="stp again" style={{ opacity: again }}>{RATING_LABEL[1]}</motion.span>
      <motion.span className="stp easy" style={{ opacity: easy }}>{RATING_LABEL[4]}</motion.span>
      <motion.span className="stp hard" style={{ opacity: hard }}>{RATING_LABEL[2]}</motion.span>
    </>
  )
}

function SeenChip({ card }: { card: DeckItem['card'] }) {
  const s = seenLabel(card)
  return <span className={'dk-seen ' + s.tone}>{s.text}</span>
}

function CardFace({ item: { word, card }, back }: { item: DeckItem; back: boolean }) {
  return (
    <>
      <div className="dk-ill">
        <WordImage word={word} />
      </div>
      {back ? (
        <div className="dk-txt" key="back">
          <Emoji name="think" size={28} className="dk-think" />
          <Lemma word={word} className="dk-wd sm" />
          <div className="dk-mn">{word.gloss_ko ?? '뜻 준비 중'}</div>
          {(word.plural || word.ipa) && (
            <div className="dk-meta">
              {word.plural && <span lang="de">복수 {word.plural}</span>}
              {word.ipa && <span>{word.ipa}</span>}
            </div>
          )}
          {word.example_de && (
            <p className="dk-ex">
              <span lang="de">
                <Example de={word.example_de} lemma={word.lemma} />
              </span>
              {word.example_ko && <span className="ko">{word.example_ko}</span>}
            </p>
          )}
        </div>
      ) : (
        <div className="dk-txt" key="front">
          <SeenChip card={card} />
          <Lemma word={word} className="dk-wd" />
          <div className="dk-meta">
            <ContentBadge size="xsmall" variant="outlined" color="neutral">{POS_LABEL[word.pos] ?? word.pos}</ContentBadge>
            <LevelBadge level={word.level} />
            {word.ipa && <span>{word.ipa}</span>}
          </div>
          {word.plural && <div className="dk-pl" lang="de">복수 {word.plural}</div>}
          <p className="dk-hint">탭하면 뜻 · 밀면 채점</p>
        </div>
      )}
    </>
  )
}
