// 덱 세션 리듀서(React 없음). 채점을 쌓았다가 한 번에 보낸다.
import { createEmptyCard, fsrs, type Card as FsrsCard, type Grade, type State } from 'ts-fsrs'
import type { Card, DeckItem, Rating, ReviewInput, ReviewsRequest, TodayResponse } from '../shared/api.ts'

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
  RESHOW_GAP: 5, // 「다시」 카드가 다시 나오기 전에 보는 카드 수(남은 카드가 이보다 적으면 맨 뒤)
  MAX_RESHOW_DAY: 3, // 오늘 덱: 오늘 안에 다시 볼 카드(학습 단계 · 다시)를 같은 판 뒤로 보내는 최대 횟수
} as const

export const RATING_LABEL: Record<Rating, string> = { 1: '다시', 2: '어려움', 3: '좋음', 4: '쉬움' }

export interface DeckSnapshot {
  queue: DeckItem[]
  index: number
  pending: ReviewInput[]
  reshows: Record<string, number>
}

export interface DeckState extends DeckSnapshot {
  /** 이 점수 이하면 줄 맨 뒤로 다시(추가 연습 = 2 「다시·어려움」). dayEnd 가 있으면 쓰지 않는다 */
  requeueUpTo: Rating
  /**
   * 오늘 덱(기획 v8 F2): 채점 뒤 다음 볼 때가 이 시각(오늘 학습일 끝)보다 앞이면 같은 판 맨 뒤로.
   * 새 카드 「좋음」의 10분 학습 단계를 판 안에서 끝내 — 판이 끝난 뒤 카드가 따로 다시 차지 않게.
   */
  dayEnd: string | null
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

export function initDeck(queue: DeckItem[], requeueUpTo: Rating = 1, dayEnd: string | null = null): DeckState {
  return { queue, index: 0, pending: [], reshows: {}, requeueUpTo, dayEnd, history: null, sentCount: 0, finished: queue.length === 0 }
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

/** 서버가 한 번에 받는 채점 수(worker postReviews 「too_many_reviews」) */
export const REVIEWS_MAX = 200

/**
 * 채점 묶음을 시각 순으로 REVIEWS_MAX 개씩 나눈다. 오늘 몫을 한 판에 하면(복습 300 + 새 단어 + 다시 본 카드) 200 을 넘을 수 있다.
 * 같은 카드의 채점이 앞 묶음 → 뒤 묶음 차례로 적히도록 시각 순으로 자르고, 보내는 쪽은 차례로 보낸다(검토 반영 2026-10-27).
 */
export function splitReviews(req: ReviewsRequest): ReviewsRequest[] {
  if (req.reviews.length <= REVIEWS_MAX) return [req]
  const sorted = [...req.reviews].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at))
  const out: ReviewsRequest[] = []
  for (let i = 0; i < sorted.length; i += REVIEWS_MAX) out.push({ ...req, reviews: sorted.slice(i, i + REVIEWS_MAX) })
  return out
}

/**
 * 오늘 세션 = 오늘 몫 전부(복습 + 새 단어)를 한 판에. first(아침 알림 빈칸 정답)는 맨 앞으로.
 * 예전엔 「한 번에 볼 카드」(session_max)씩 끊어 여러 번 나눠 해야 했다(2026-10-27 사용자 지시로 끊지 않음).
 */
export function buildSession(today: TodayResponse, first: string | null = null): DeckItem[] {
  return firstUp([...today.due, ...today.fresh], first)
}

/** 섞기(추가 연습·관사). rand 를 넣으면 시험에서 같은 결과 */
export function shuffle<T>(list: T[], rand: () => number = Math.random): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 아침 알림 빈칸 문제의 정답 카드를 맨 앞으로(없으면 그대로) */
export function firstUp(queue: DeckItem[], id: string | null): DeckItem[] {
  const i = id ? queue.findIndex((it) => it.word.id === id) : -1
  return i <= 0 ? queue : [queue[i], ...queue.slice(0, i), ...queue.slice(i + 1)]
}

export function current(s: DeckState): DeckItem | undefined {
  return s.finished ? undefined : s.queue[s.index]
}

/** 방금 본 카드(index)를 RESHOW_GAP 장 뒤에 다시 끼운다. 남은 카드가 그보다 적으면 맨 뒤 */
function reinsert(queue: DeckItem[], index: number, item: DeckItem): DeckItem[] {
  const at = Math.min(queue.length, index + 1 + SWIPE.RESHOW_GAP)
  return [...queue.slice(0, at), item, ...queue.slice(at)]
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
      if (s.dayEnd) {
        // 서버와 같은 계산(ts-fsrs · 흔들림 끔 · 같은 채점 시각)이라 다음 장의 간격 글자도 서버 결과와 같다
        const next = nextCard(item.card, a.rating, new Date(a.at))
        if (!next.suspended && Date.parse(next.due) < Date.parse(s.dayEnd) && seen < SWIPE.MAX_RESHOW_DAY) {
          queue = reinsert(s.queue, s.index, { ...item, card: next })
          reshows = { ...s.reshows, [id]: seen + 1 }
        }
      } else if (a.rating <= s.requeueUpTo && seen < SWIPE.MAX_RESHOW) {
        queue = reinsert(s.queue, s.index, item)
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
      return initDeck(a.queue, s.requeueUpTo, s.dayEnd)
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

/** 이만큼 잊으면 서버가 카드를 쉬게 한다(worker/fsrs.ts SUSPEND_LAPSES) */
const SUSPEND_LAPSES = 8

/** 쉬움(4)의 다음 간격 상한(일). worker/fsrs.ts 의 EASY_MAX_DAYS 와 같은 값 */
export const EASY_MAX_DAYS = 120

/** 채점 하나를 적용한 다음 카드(worker/fsrs.ts applyRating 과 같은 계산 — 첫 채점 도장 · 쉼 · 쉬움 상한 120일 포함) */
export function nextCard(card: Card, rating: Rating, at: Date): Card {
  const { card: c } = scheduler.next(toFsrsCard(card), at, rating as Grade)
  const next: Card = {
    ...card,
    state: c.state as Card['state'],
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    last_review: c.last_review ? c.last_review.toISOString() : null,
    introduced_at: card.state === 0 ? at.toISOString() : card.introduced_at,
    suspended: c.lapses >= SUSPEND_LAPSES ? 1 : card.suspended,
  }
  if (rating === 4 && Date.parse(next.due) > at.getTime() + EASY_MAX_DAYS * 86400_000) {
    next.due = new Date(at.getTime() + EASY_MAX_DAYS * 86400_000).toISOString()
    next.scheduled_days = EASY_MAX_DAYS
  }
  return next
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
  const label = (g: Grade) => intervalLabel(Math.min(r[g].card.due.getTime() - now.getTime(), g === 4 ? EASY_MAX_DAYS * 86400_000 : Infinity))
  return { 1: label(1), 2: label(2), 3: label(3), 4: label(4) }
}
