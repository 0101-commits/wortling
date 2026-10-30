// ts-fsrs 카드 ↔ cards 행 변환 + 채점 적용. 순수 함수(DB 없음).
import type { Card as FsrsCard, Grade, ReviewLog } from 'ts-fsrs';
import type { Card, CardState, Rating } from '../shared/api.ts';
import { EASY_MAX_DAYS, SUSPEND_LAPSES, WEAK_LAPSES, makeScheduler } from '../shared/fsrs.ts';

export { EASY_MAX_DAYS, SUSPEND_LAPSES, WEAK_LAPSES };

// 기본 매개변수 + 단어·채점 횟수로 씨앗을 정한 흔들림(같은 입력 → 같은 결과, 앱 src/deck.ts 와 같은 날짜)
const scheduler = makeScheduler();

/** 지금 기억률(0~1): FSRS stability 와 마지막 채점 뒤 경과일로. 아직 안 배운 카드·기록 없는 카드는 0 */
export function retrievability(row: Card, now: Date): number {
  if (!row.last_review || row.stability <= 0) return 0;
  return scheduler.get_retrievability(rowToCard(row), now, false);
}

export function rowToCard(row: Card): FsrsCard {
  // word_id 는 흔들림 씨앗용(shared/fsrs.ts) — ts-fsrs 는 모르는 열을 그대로 둔다
  return {
    word_id: row.word_id,
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  } as FsrsCard;
}

export function cardToRow(
  card: FsrsCard,
  base: Pick<Card, 'word_id' | 'introduced_at' | 'suspended' | 'suspended_at'>,
): Card {
  return {
    word_id: base.word_id,
    state: card.state as CardState,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    last_review: card.last_review ? card.last_review.toISOString() : null,
    introduced_at: base.introduced_at,
    suspended: base.suspended,
    suspended_at: base.suspended_at ?? null,
  };
}

/**
 * 카드 한 장에 채점 하나를 적용한 다음 행을 돌려준다.
 * 첫 채점(state 0)이면 introduced_at 에 채점 시각 도장, 새로 잊어 8번째가 되면 쉼 처리(suspended_at 도장 — 30일 뒤 깨운 카드는 한 번 더 잊을 때까지 안 쉰다).
 * 흔들림이 켜져 간격이 앞뒤로 흩어진다(2.5일 이상만, 씨앗은 단어 id + 채점 횟수).
 * 쉬움(4)은 FSRS 가 정상 계산하고 간격만 120일(EASY_MAX_DAYS)로 막는다(2026-10-30 사용자 결정, 10-29의 「무조건 120일」을 바꿈).
 * 기억 수치(stability)는 손대지 않는다 — 일정이 아니라 기억 추정치라, 120일에 일찍 보면 다음 계산이 실제 경과일의 기억률로 맞춘다.
 */
export function applyRating(row: Card, rating: Rating, now: Date): { nextRow: Card; log: ReviewLog } {
  const { card, log } = scheduler.next(rowToCard(row), now, rating as Grade);
  const suspend = card.lapses > row.lapses && card.lapses >= SUSPEND_LAPSES;
  const nextRow = cardToRow(card, {
    word_id: row.word_id,
    introduced_at: row.state === 0 ? now.toISOString() : row.introduced_at,
    suspended: suspend ? 1 : row.suspended,
    suspended_at: suspend ? now.toISOString() : row.suspended_at,
  });
  if (rating === 4 && Date.parse(nextRow.due) > now.getTime() + EASY_MAX_DAYS * 86400_000) {
    nextRow.due = new Date(now.getTime() + EASY_MAX_DAYS * 86400_000).toISOString();
    nextRow.scheduled_days = EASY_MAX_DAYS;
  }
  return { nextRow, log };
}
