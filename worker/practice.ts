// 더 공부하기(기획 v8 과제 4): 연습 재료 고르기 · 결과 적기.
// 결과는 practice 표에 적고, 틀린 단어는 「아직 잘 모르는 단어」로 — 카드에 「다시」 채점(2026-10-27 기능 검토, D4 「FSRS 미반영」을 바꿈).
import type { Card, PracticeMode, PracticeResponse, PracticeResultsRequest, PracticeSaveResponse, Settings } from '../shared/api.ts';
import { ITEM_SELECT, PRACTICE_SESSION, levelsFor, rowToItem } from './deck.ts';
import { applyRating } from './fsrs.ts';
import { bad } from './http.ts';
import { addDays, studyDay, studyDayStartUtc } from './time.ts';

export const PRACTICE_MODES: readonly PracticeMode[] = ['cloze', 'match', 'meaning', 'meaning_rev', 'write'];
/** 예전 방식(예문 속 단어 짚기 → 짝 맞추기로 바뀜). 옛 화면이 기기에 남아 보내는 결과도 받는다 */
const LEGACY_MODES: readonly string[] = ['pick'];
/** 「틀린 단어」 범위: 최근 30일 연습에서 그 단어의 마지막 결과가 틀림 */
const WRONG_DAYS = 30;
/** 보기(오답) 재료: 배운 단어 무작위 · 아직 안 배운 같은 레벨 단어(배운 단어가 적은 품사도 4지선다가 되게) */
const POOL_LEARNED = 300;
const POOL_MORE = 100;

/**
 * 배운 카드는 c.state IN (1, 2, 3) 으로 고른다 — != 0 은 색인을 못 타 카드 전체(≈9천 행)를 두 번 훑었다(검토 반영, D1 하루 읽기 한도).
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
             WHERE c.state IN (1, 2, 3) AND c.suspended = 0${since ? ' AND c.last_review >= ?' : ''} ORDER BY random() LIMIT ?`,
          )
          .bind(...(since ? [since, take] : [take]));
  const [it, learned, more] = await db.batch([
    items,
    db
      .prepare(
        `SELECT w.id, w.lemma, w.pos, w.gender, w.gloss_ko FROM words w JOIN cards c ON c.word_id = w.id
         WHERE c.state IN (1, 2, 3) AND w.gloss_ko IS NOT NULL ORDER BY random() LIMIT ?`,
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

/**
 * 결과 묶음(최대 200). 없는 단어 id 는 조용히 건너뛴다(SELECT … FROM words WHERE id = ?).
 * 틀린 단어(배운 카드)는 「다시」 채점 → 가중형 미루기(2026-10-29): 처음 틀리면 모레, 또 틀리면 내일 몫에.
 * 이미 오늘 몫에 든 카드(오늘 학습일 안에 마감)는 그대로 — 덱에서 곧 채점하니 두 번 깎지 않는다. 같은 카드를 여러 번 틀려도 한 번만.
 * 잊은 수(lapses)·쉬게 하기(suspended)는 그대로 둔다 — 보기를 잘못 누른 것까지 세면 8번에 카드가 덱에서 빠진다(검토 반영).
 */
export async function savePractice(db: D1Database, b: PracticeResultsRequest | null, now: Date = new Date()): Promise<PracticeSaveResponse> {
  if (!b || !(PRACTICE_MODES.includes(b.mode) || LEGACY_MODES.includes(b.mode)) || !Array.isArray(b.results)) throw bad('bad_request');
  if (b.results.length > 200) throw bad('too_many_results');
  for (const r of b.results) {
    if (typeof r?.word_id !== 'string' || typeof r.correct !== 'boolean' || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at)))
      throw bad('bad_result');
  }
  if (!b.results.length) return { ok: true, count: 0, relearn: [] };
  const relearn = await relearnStatements(db, b.results, now);
  await db.batch([
    ...b.results.map((r) =>
      db
        .prepare('INSERT INTO practice(mode, word_id, correct, at) SELECT ?, id, ?, ? FROM words WHERE id = ?')
        .bind(b.mode, r.correct ? 1 : 0, new Date(r.at).toISOString(), r.word_id),
    ),
    ...relearn.stmts,
  ]);
  return { ok: true, count: b.results.length, relearn: relearn.ids };
}

/** 틀린 단어마다 첫 틀림 시각으로 「다시」 채점(덱 채점과 같은 계산 — worker/fsrs.ts applyRating).
 * 2026-10-29 가중형 미루기: 채점 1 패널티는 그대로 주되 나오는 시점을 미룬다.
 * 처음 틀리면 모레(+2일), 이전에도 틀린 적 있으면 내일(+1일) — 자주 틀릴수록 빨리.
 * 이전 틀림은 이번 묶음보다 이른 practice 기록으로 본다. */
async function relearnStatements(db: D1Database, results: PracticeResultsRequest['results'], now: Date) {
  const firstWrong = new Map<string, string>();
  for (const r of results) {
    if (r.correct) continue;
    const at = new Date(r.at).toISOString();
    const had = firstWrong.get(r.word_id);
    if (!had || at < had) firstWrong.set(r.word_id, at);
  }
  const ids = [...firstWrong.keys()];
  const stmts: D1PreparedStatement[] = [];
  const out: string[] = [];
  if (!ids.length) return { stmts, ids: out };
  const dayEnd = Date.parse(studyDayStartUtc(addDays(studyDay(now), 1)));
  // 이번 묶음보다 이른 시각의 틀림 기록 = 이전에 틀린 적 있는 단어
  const earliest = [...firstWrong.values()].reduce((a, b) => (a < b ? a : b));
  const prevWrong = new Set<string>();
  // 바인딩 상한 100
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { results: rows } = await db
      .prepare(`SELECT * FROM cards WHERE word_id IN (${chunk.map(() => '?').join(',')}) AND state IN (1, 2, 3) AND suspended = 0`)
      .bind(...chunk)
      .all<Card>();
    const { results: pw } = await db
      .prepare(`SELECT DISTINCT word_id FROM practice WHERE word_id IN (${chunk.map(() => '?').join(',')}) AND correct = 0 AND at < ?`)
      .bind(...chunk, earliest)
      .all<{ word_id: string }>();
    for (const r of pw) prevWrong.add(r.word_id);
    for (const prev of rows) {
      if (Date.parse(prev.due) < dayEnd) continue;
      // 채점 시각: 기기 시각이 마지막 채점보다 앞서거나 지금보다 뒤면 당긴다(간격 계산이 음수·미래가 되지 않게)
      const last = prev.last_review ? Date.parse(prev.last_review) : 0;
      const at = new Date(Math.min(now.getTime(), Math.max(Date.parse(firstWrong.get(prev.word_id)!), last)));
      const { nextRow: c, log } = applyRating(prev, 1, at);
      // 가중형 미루기: 처음 틀리면 모레, 또 틀리면 내일(학습일 기준)
      const deferDays = prevWrong.has(prev.word_id) ? 1 : 2;
      c.due = studyDayStartUtc(addDays(studyDay(now), deferDays));
      c.scheduled_days = deferDays;
      // 읽은 뒤 덱 채점이 먼저 바꿨으면(due 다름) 둘 다 건너뛴다 — 적기가 먼저(바꾼 뒤엔 due 가 달라 못 찾음)
      stmts.push(
        db
          .prepare(
            `INSERT INTO reviews(word_id, rating, reviewed_at, elapsed_days, scheduled_days, session_id, prev_json)
             SELECT word_id, 1, ?, ?, ?, ?, ? FROM cards WHERE word_id = ? AND due = ?`,
          )
          .bind(at.toISOString(), log.elapsed_days, c.scheduled_days, PRACTICE_SESSION, JSON.stringify(prev), prev.word_id, prev.due),
        db
          .prepare(
            `UPDATE cards SET state = ?, due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
             learning_steps = ?, reps = ?, lapses = ?, last_review = ?, suspended = ? WHERE word_id = ? AND due = ?`,
          )
          .bind(
            c.state, c.due, c.stability, c.difficulty, c.elapsed_days, c.scheduled_days,
            c.learning_steps, c.reps, prev.lapses, c.last_review, prev.suspended, prev.word_id, prev.due,
          ),
      );
      out.push(prev.word_id);
    }
  }
  return { stmts, ids: out };
}
