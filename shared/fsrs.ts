// 서버(worker/fsrs.ts)와 앱(src/deck.ts)이 같이 쓰는 FSRS 스케줄러 · 학습 상수. 두 쪽이 같은 날짜를 내야 하므로 한 곳에서 만든다.
import { fsrs, StrategyMode } from 'ts-fsrs';
import type { Card as FsrsCard } from 'ts-fsrs';

/** 이만큼 새로 잊으면 「약한 단어」(배지 · 연습 우선 · 예문 검토 우선) */
export const WEAK_LAPSES = 4;
/** 이만큼 잊으면 카드를 쉬게 한다(suspended = 1) — UNSUSPEND_DAYS 일 뒤 저절로 깨운다 */
export const SUSPEND_LAPSES = 8;
export const UNSUSPEND_DAYS = 30;
/** 쉬움(4)의 다음 간격 상한(일) */
export const EASY_MAX_DAYS = 120;

/** 흔들림 씨앗 = 단어 id + 채점 횟수. 시각·기억 수치가 안 들어가 미리보기 글자와 실제 채점이 같고 서버·앱도 같다 */
function seedOfCard(this: { current: FsrsCard & { word_id?: string } }): string {
  return `${this.current.word_id ?? ''}_${this.current.reps}`;
}

/** 기본 매개변수 + 흔들림 켬(같은 날 배운 단어가 같은 날 몰려 마감되지 않게). 카드에 word_id 를 실어 보내야 씨앗이 단어마다 다르다 */
export function makeScheduler() {
  return fsrs({ enable_fuzz: true }).useStrategy(StrategyMode.SEED, seedOfCard as never);
}

/** 쉬는 카드 깨울 기준 시각(ISO): 이보다 먼저 쉬기 시작한 카드를 깨운다 */
export const unsuspendCutoff = (now: Date): string => new Date(now.getTime() - UNSUSPEND_DAYS * 86400_000).toISOString();
