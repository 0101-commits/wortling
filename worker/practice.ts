// 더 공부하기(기획 v8 과제 4): 연습 재료 고르기 · 결과 적기. 결과는 practice 표에만 — 복습 일정(cards)은 안 바꾼다(D4).
import type { PracticeMode, PracticeResponse, PracticeResultsRequest, Settings } from '../shared/api.ts';
import { ITEM_SELECT, levelsFor, rowToItem } from './deck.ts';
import { bad } from './http.ts';
import { addDays, studyDay, studyDayStartUtc } from './time.ts';

export const PRACTICE_MODES: readonly PracticeMode[] = ['cloze', 'pick', 'meaning', 'meaning_rev'];
/** 「틀린 단어」 범위: 최근 30일 연습에서 그 단어의 마지막 결과가 틀림 */
const WRONG_DAYS = 30;
/** 보기(오답) 재료: 배운 단어 무작위 · 아직 안 배운 같은 레벨 단어(배운 단어가 적은 품사도 4지선다가 되게) */
const POOL_LEARNED = 300;
const POOL_MORE = 100;

/**
 * 범위 안 배운 카드 무작위 + 보기 재료. 문제를 못 만드는 카드(예문 없음 등)가 섞이니 n 의 두 배(최대 100)까지 받고,
 * 화면이 문제를 만들 수 있는 것에서 n 개를 고른다.
 * scope: today = 오늘 학습일에 본 카드 · week = 최근 7학습일 · all = 배운 카드 전체 · wrong = 연습에서 마지막으로 틀린 단어.
 */
export async function practiceItems(
  db: D1Database,
  settings: Settings,
  scope: string | null,
  n: number,
  now: Date = new Date(),
): Promise<PracticeResponse> {
  const take = Math.min(100, n * 2);
  const day = studyDay(now);
  const levels = levelsFor(settings.level);
  const since = scope === 'today' ? studyDayStartUtc(day) : scope === 'week' ? studyDayStartUtc(addDays(day, -6)) : null;
  const items =
    scope === 'wrong'
      ? db
          .prepare(
            `SELECT ${ITEM_SELECT} FROM words w JOIN cards c ON c.word_id = w.id
             WHERE w.id IN (SELECT word_id FROM practice WHERE at >= ? GROUP BY word_id HAVING max(id) = max(CASE WHEN correct = 0 THEN id END))
             ORDER BY random() LIMIT ?`,
          )
          .bind(studyDayStartUtc(addDays(day, -(WRONG_DAYS - 1))), take)
      : db
          .prepare(
            `SELECT ${ITEM_SELECT} FROM words w JOIN cards c ON c.word_id = w.id
             WHERE c.state != 0 AND c.suspended = 0${since ? ' AND c.last_review >= ?' : ''} ORDER BY random() LIMIT ?`,
          )
          .bind(...(since ? [since, take] : [take]));
  const [it, learned, more] = await db.batch([
    items,
    db
      .prepare(
        `SELECT w.id, w.lemma, w.pos, w.gender, w.gloss_ko FROM words w JOIN cards c ON c.word_id = w.id
         WHERE c.state != 0 AND w.gloss_ko IS NOT NULL ORDER BY random() LIMIT ?`,
      )
      .bind(POOL_LEARNED),
    db
      .prepare(
        `SELECT w.id, w.lemma, w.pos, w.gender, w.gloss_ko FROM words w JOIN cards c ON c.word_id = w.id
         WHERE c.state = 0 AND w.gloss_ko IS NOT NULL AND w.level IN (${levels.map(() => '?').join(',')}) ORDER BY w.seq LIMIT ?`,
      )
      .bind(...levels, POOL_MORE),
  ]);
  const plain = (r: D1Result) => (r.results as Record<string, unknown>[]).map((x) => ({ ...x }));
  return {
    items: (it.results as Record<string, unknown>[]).map(rowToItem),
    pool: [...plain(learned), ...plain(more)] as PracticeResponse['pool'],
  };
}

/** 결과 묶음(최대 200). 없는 단어 id 는 조용히 건너뛴다(SELECT … FROM words WHERE id = ?) */
export async function savePractice(db: D1Database, b: PracticeResultsRequest | null): Promise<{ ok: true; count: number }> {
  if (!b || !PRACTICE_MODES.includes(b.mode) || !Array.isArray(b.results)) throw bad('bad_request');
  if (b.results.length > 200) throw bad('too_many_results');
  for (const r of b.results) {
    if (typeof r?.word_id !== 'string' || typeof r.correct !== 'boolean' || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at)))
      throw bad('bad_result');
  }
  if (b.results.length)
    await db.batch(
      b.results.map((r) =>
        db
          .prepare('INSERT INTO practice(mode, word_id, correct, at) SELECT ?, id, ?, ? FROM words WHERE id = ?')
          .bind(b.mode, r.correct ? 1 : 0, new Date(r.at).toISOString(), r.word_id),
      ),
    );
  return { ok: true, count: b.results.length };
}
