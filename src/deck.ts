// 덱 세션 리듀서(React 없음). 채점을 쌓았다가 한 번에 보낸다.
import { createEmptyCard, fsrs, type Card as FsrsCard, type Grade, type State } from 'ts-fsrs'
import type { Card, DeckItem, Rating, ReviewInput, TodayResponse } from '../shared/api.ts'

/** 밀기 상수(기획 고정값) */
export const SWIPE = {
  COMMIT_X: 80, // px, 가로 확정
  COMMIT_Y: 70, // px, 세로 확정
  VERTICAL_RATIO: 1.2, // |y| > |x|×1.2 일 때만 세로
  VELOCITY: 0.45, // px/ms
  TILT_DIV: 18, // 기울기 = x/18
  TILT_MAX: 15, // deg
  STAMP_DIV: 80, // 도장 불투명도 = |x|/80
  EXIT_MS: 260,
  EXIT_PX: 600,
  SNAP_MS: 220,
  TAP_PX: 8,
  TAP_MS: 250,
  BACK_SCALE: 0.94,
  VISIBLE: 3,
  MAX_RESHOW: 2, // 「다시」 카드가 한 세션에 다시 나오는 최대 횟수
} as const

export const RATING_LABEL: Record<Rating, string> = { 1: '다시', 2: '어려움', 3: '좋음', 4: '쉬움' }

export interface DeckSnapshot {
  queue: DeckItem[]
  index: number
  pending: ReviewInput[]
  reshows: Record<string, number>
}

export interface DeckState extends DeckSnapshot {
  history: DeckSnapshot | null // 되돌리기 1단계
  /** pending 중 앞에서 몇 개를 이미 보냈는지. 보낸 채점은 되돌릴 수 없다. */
  sentCount: number
  finished: boolean
}

export type DeckAction =
  | { type: 'grade'; rating: Rating; at: string }
  | { type: 'undo' }
  | { type: 'flush' }
  | { type: 'reset'; queue: DeckItem[] }

export function initDeck(queue: DeckItem[]): DeckState {
  return { queue, index: 0, pending: [], reshows: {}, history: null, sentCount: 0, finished: queue.length === 0 }
}

/** 놓은 순간의 이동(px)·속도(px/ms)로 채점을 정한다. 못 넘으면 null(제자리로). */
export function decideSwipe(dx: number, dy: number, vx: number, vy: number, mode: 2 | 4): Rating | null {
  const past = (d: number, v: number, min: number) =>
    Math.abs(d) >= min || (Math.abs(d) >= SWIPE.TAP_PX && Math.abs(v) >= SWIPE.VELOCITY && Math.sign(v) === Math.sign(d))
  if (mode === 4 && Math.abs(dy) > Math.abs(dx) * SWIPE.VERTICAL_RATIO) {
    return past(dy, vy, SWIPE.COMMIT_Y) ? (dy < 0 ? 4 : 2) : null
  }
  return past(dx, vx, SWIPE.COMMIT_X) ? (dx > 0 ? 3 : 1) : null
}

/** 오늘 세션 = 복습 + 새 단어, session_max 까지 */
export function buildSession(today: TodayResponse): DeckItem[] {
  return [...today.due, ...today.fresh].slice(0, today.settings.session_max)
}

export function current(s: DeckState): DeckItem | undefined {
  return s.finished ? undefined : s.queue[s.index]
}

export function deckReducer(s: DeckState, a: DeckAction): DeckState {
  switch (a.type) {
    case 'grade': {
      const item = current(s)
      if (!item) return s
      const id = item.word.id
      const snapshot: DeckSnapshot = { queue: s.queue, index: s.index, pending: s.pending, reshows: s.reshows }
      const pending = [...s.pending, { word_id: id, rating: a.rating, reviewed_at: a.at }]
      let queue = s.queue
      let reshows = s.reshows
      const seen = s.reshows[id] ?? 0
      if (a.rating === 1 && seen < SWIPE.MAX_RESHOW) {
        queue = [...s.queue, item]
        reshows = { ...s.reshows, [id]: seen + 1 }
      }
      const index = s.index + 1
      return { ...s, queue, index, pending, reshows, history: snapshot, finished: index >= queue.length }
    }
    case 'undo': {
      if (!s.history) return s
      return { ...s, ...s.history, history: null, finished: false }
    }
    case 'flush':
      return s.pending.length > s.sentCount ? { ...s, sentCount: s.pending.length, history: null } : s
    case 'reset':
      return initDeck(a.queue)
  }
}

// ── ts-fsrs 로 4단계 간격 글자 만들기 ──
const scheduler = fsrs({ enable_fuzz: false })

function toFsrsCard(c: Card): FsrsCard {
  const base = createEmptyCard(new Date(c.due))
  return {
    ...base,
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as State,
    last_review: c.last_review ? new Date(c.last_review) : undefined,
  }
}

/** 1시간 미만 n분 · 1일 미만 n시간 · 그 외 n일 */
export function intervalLabel(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min}분`
  const h = Math.round(ms / 3_600_000)
  if (h < 24) return `${h}시간`
  return `${Math.max(1, Math.round(ms / 86_400_000))}일`
}

export function intervals(card: Card, now = new Date()): Record<Rating, string> {
  const r = scheduler.repeat(toFsrsCard(card), now)
  const label = (g: Grade) => intervalLabel(r[g].card.due.getTime() - now.getTime())
  return { 1: label(1), 2: label(2), 3: label(3), 4: label(4) }
}
