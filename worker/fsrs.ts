// ts-fsrs 카드 ↔ cards 행 변환 + 채점 적용. 순수 함수(DB 없음).
import { fsrs } from 'ts-fsrs';
import type { Card as FsrsCard, Grade, ReviewLog } from 'ts-fsrs';
import type { Card, CardState, Rating } from '../shared/api.ts';

// 기본 매개변수, 무작위 흔들림 끔(같은 입력 → 같은 결과, 시험 가능)
const scheduler = fsrs({ enable_fuzz: false });

/** 이만큼 잊으면 카드를 쉬게 한다(suspended = 1) */
export const SUSPEND_LAPSES = 8;

export function rowToCard(row: Card): FsrsCard {
  return {
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
  };
}

export function cardToRow(
  card: FsrsCard,
  base: Pick<Card, 'word_id' | 'introduced_at' | 'suspended'>,
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
  };
}

/**
 * 카드 한 장에 채점 하나를 적용한 다음 행을 돌려준다.
 * 첫 채점(state 0)이면 introduced_at 에 채점 시각 도장, 잊은 횟수가 8 이상이면 쉼 처리.
 * 쉬움(4)이면 120일 뒤로 — FSRS 기본 간격(약 4일)이 짧다는 사용자 판단(2026-10-29).
 * 기억 수치(stability·difficulty)는 그대로 두어 나중에 틀리면 정상적으로 깎인다.
 */
export function applyRating(row: Card, rating: Rating, now: Date): { nextRow: Card; log: ReviewLog } {
  const { card, log } = scheduler.next(rowToCard(row), now, rating as Grade);
  const nextRow = cardToRow(card, {
    word_id: row.word_id,
    introduced_at: row.state === 0 ? now.toISOString() : row.introduced_at,
    suspended: card.lapses >= SUSPEND_LAPSES ? 1 : row.suspended,
  });
  if (rating === 4) {
    const due = new Date(now.getTime() + 120 * 86400_000);
    nextRow.due = due.toISOString();
    nextRow.scheduled_days = 120;
  }
  return { nextRow, log };
}
