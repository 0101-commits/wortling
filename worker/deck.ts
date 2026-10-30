// 오늘 카드 고르기. GET /api/today 와 아침 알림(cron)이 같은 함수를 쓴다.
import type { CardState, DeckItem, Level, Pos, Settings } from '../shared/api.ts';
import { addDays, studyDay, studyDayStartUtc } from './time.ts';
import { bad } from './http.ts';
import { retrievability } from './fsrs.ts';
import { unsuspendCutoff } from '../shared/fsrs.ts';

/** words w JOIN cards c 에서 DeckItem 을 만들 때 고르는 열(열 이름이 겹치지 않게 w.id / c.word_id) */
export const ITEM_SELECT = `w.id, w.lemma, w.pos, w.gender, w.plural, w.ipa, w.level, w.gloss_en, w.gloss_ko,
  w.example_de, w.example_ko, w.example_hit, w.image_status, w.seq,
  c.word_id, c.state, c.due, c.stability, c.difficulty, c.elapsed_days, c.scheduled_days,
  c.learning_steps, c.reps, c.lapses, c.last_review, c.introduced_at, c.suspended`;

export function rowToItem(r: Record<string, unknown>): DeckItem {
  const s = (k: string) => (r[k] == null ? null : String(r[k]));
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    word: {
      id: String(r.id),
      lemma: String(r.lemma),
      pos: r.pos as Pos,
      gender: s('gender'),
      plural: s('plural'),
      ipa: s('ipa'),
      level: r.level as Level,
      gloss_en: s('gloss_en'),
      gloss_ko: s('gloss_ko'),
      example_de: s('example_de'),
      example_ko: s('example_ko'),
      example_hit: s('example_hit'),
      image: r.image_status === 'ok',
      seq: n('seq'),
    },
    card: {
      word_id: String(r.word_id),
      state: n('state') as CardState,
      due: String(r.due),
      stability: n('stability'),
      difficulty: n('difficulty'),
      elapsed_days: n('elapsed_days'),
      scheduled_days: n('scheduled_days'),
      learning_steps: n('learning_steps'),
      reps: n('reps'),
      lapses: n('lapses'),
      last_review: s('last_review'),
      introduced_at: s('introduced_at'),
      suspended: (n('suspended') ? 1 : 0) as 0 | 1,
    },
  };
}

/** 설정 수준에서 새 단어로 꺼낼 수 있는 등급: B1 → B1만, B2 → B1·B2, C1 → B1·B2·C1 */
export function levelsFor(level: Level): Level[] {
  return level === 'C1' ? ['B1', 'B2', 'C1'] : level === 'B2' ? ['B1', 'B2'] : ['B1'];
}

/** settings 표(문자열 값) → Settings */
export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const m: Record<string, string> = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    new_per_day: Number(m.new_per_day ?? 5),
    session_max: Number(m.session_max ?? 25),
    level: m.level === 'C1' ? 'C1' : m.level === 'B2' ? 'B2' : 'B1',
    vacation_until: m.vacation_until ?? '',
    swipe_mode: m.swipe_mode === '2' ? 2 : 4,
    onboarded: m.onboarded === '1',
    evening_mode: m.evening_mode === 'any_left' ? 'any_left' : 'none_today',
    evening_min: Math.max(1, Number(m.evening_min ?? 1) || 1),
    review_only_day: m.review_only_day ?? '',
    discord_on: m.discord_on !== '0',
  };
}

export interface Today {
  date: string;
  /** 오늘 학습일이 끝나는 시각(다음 날 04:00 KST, ISO). 이보다 앞에 마감되는 카드가 오늘 몫 */
  day_end: string;
  due: DeckItem[];
  fresh: DeckItem[];
  new_done_today: number;
  reviewed_today: number;
  plan: TodayPlan;
  /** 오늘 채점 수: 좋음·쉬움 / 다시·어려움 */
  ratings: { good: number; again: number };
}

/** 연습에서 「다시」 채점한 줄의 session_id(reviews). 덱 채점과 가른다(worker/practice.ts 가 적음) */
export const PRACTICE_SESSION = 'practice';
/** 오늘 몫에서 한 번에 보내는 복습 상한(안전장치). 덱은 오늘 몫을 끊지 않고 한 판에(2026-10-27) */
const DUE_MAX = 300;
/** 복습이 밀렸을 때 새 단어 줄이기: 밀린 복습 > 100 이면 절반(내림), > 200 이면 0 */
export function freshAllowance(newPerDay: number, backlog: number): number {
  return backlog > 200 ? 0 : backlog > 100 ? Math.floor(newPerDay / 2) : newPerDay;
}
/** 「새 단어 더 받기」 한 번 · 하루 최대(D3) */
export const EXTRA_STEP = 5;
export const EXTRA_MAX = 20;
/** 오늘 몫 줄을 이만큼 지난 것은 지운다 */
const PLAN_KEEP_DAYS = 30;

interface PlanRow {
  fresh: string[];
  extra: number;
}
const parsePlan = (r: { fresh: string; extra: number } | null): PlanRow | null => {
  if (!r) return null;
  try {
    const ids = JSON.parse(r.fresh) as unknown;
    return { fresh: Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [], extra: Number(r.extra) || 0 };
  } catch {
    return { fresh: [], extra: Number(r.extra) || 0 };
  }
};

/** 비슷한 단어 판정용 열쇠: 관사·sich 떼고 소문자·움라우트 풀기·글자만 */
const simKey = (lemma: string) =>
  lemma
    .toLowerCase()
    .replace(/^(?:der|die|das|ein|eine|sich)\s+/, '')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z]/g, '');

/** 비슷한 단어: 열쇠가 같거나, 둘 다 6글자 이상이고 앞 다섯 글자가 같거나, 짧은 쪽(5글자 이상)이 긴 쪽의 앞부분 */
export function similarWords(a: string, b: string): boolean {
  const x = simKey(a);
  const y = simKey(b);
  if (!x || !y) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s === l || (s.length >= 5 && l.startsWith(s)) || (s.length >= 6 && s.slice(0, 5) === l.slice(0, 5));
}

/** 후보를 차례로 보며 이미 고른 단어(have)나 앞서 고른 후보와 비슷한 것은 건너뛴다(그 단어는 다른 날로). 최대 n 개.
 *  건너뛴 것만 남아 n 개가 안 차면 건너뛴 후보로 차례대로 채운다 — 비슷함은 선호일 뿐 그날 몫을 줄이지 않는다 */
export function pickDistinct<T extends { lemma: string }>(cands: T[], have: string[], n: number): T[] {
  const taken = [...have];
  const out: T[] = [];
  const skipped: T[] = [];
  for (const c of cands) {
    if (out.length >= n) break;
    if (taken.some((t) => similarWords(t, c.lemma))) {
      skipped.push(c);
      continue;
    }
    taken.push(c.lemma);
    out.push(c);
  }
  return out.length < n ? [...out, ...skipped.slice(0, n - out.length)] : out;
}

/** 쉬기 시작한 지 30일(UNSUSPEND_DAYS) 지난 카드를 깨운다(8번 잊어 쉬던 카드 · 마이그레이션 0009) */
export async function wakeSuspended(db: D1Database, now: Date = new Date()): Promise<void> {
  await db.prepare('UPDATE cards SET suspended = 0, suspended_at = NULL WHERE suspended = 1 AND suspended_at IS NOT NULL AND suspended_at < ?').bind(unsuspendCutoff(now)).run();
}

/** 새 단어 후보: 안 배운 카드, 레벨 안(또는 내가 넣은 단어), 학습 순서. except = 이미 고른 id(JSON 배열).
 *  비슷한 단어는 같은 날 겹치지 않게(L7): have = 이미 그날 목록·오늘 배운 단어의 표제어. 건너뛴 단어는 다른 날 후보로 남는다 */
async function freshCandidates(db: D1Database, settings: Settings, n: number, except: string[] = [], have: string[] = []) {
  const levels = levelsFor(settings.level);
  const { results } = await db
    .prepare(
      `SELECT w.id, w.lemma FROM cards c JOIN words w ON w.id = c.word_id
       WHERE c.state = 0 AND c.suspended = 0 AND (w.level IN (${levels.map(() => '?').join(',')}) OR w.pinned = 1)
         AND w.id NOT IN (SELECT value FROM json_each(?))
       ORDER BY w.pinned DESC, w.seq, w.lemma LIMIT ?`,
    )
    .bind(...levels, JSON.stringify(except), n * 6 + 30)
    .all<{ id: string; lemma: string }>();
  return pickDistinct(results, have, n);
}

/** 표제어 모음: 단어 id 목록 + 학습일 시작 뒤에 처음 배운 단어(날짜 지정 시) */
async function lemmasOf(db: D1Database, ids: string[], since?: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT w.lemma FROM words w WHERE w.id IN (SELECT value FROM json_each(?))
       UNION SELECT w.lemma FROM words w JOIN cards c ON c.word_id = w.id WHERE ? IS NOT NULL AND c.introduced_at >= ?`,
    )
    .bind(JSON.stringify(ids), since ?? null, since ?? '')
    .all<{ lemma: string }>();
  return results.map((r) => r.lemma);
}

const readPlan = (db: D1Database, date: string) =>
  db.prepare('SELECT fresh, extra FROM day_plans WHERE day = ?').bind(date).first<{ fresh: string; extra: number }>();

/**
 * 그날 새 단어 목록(F1·F5). 처음 부를 때(아침 알림 또는 그날 처음 연 앱) 한 번 정해 day_plans 에 적는다.
 * 그 뒤로는 단어 작업이 학습 순서를 다시 매기거나 새 단어를 넣어도 그날 목록은 그대로.
 * 알림과 앱이 동시에 만들어도 ON CONFLICT 로 먼저 적힌 하나만 남는다.
 * fresh = '' 는 「설정이 바뀌어 다시 정할 목록」(dropPlan) — 더 받은 수(extra)는 남겨 그만큼 더 고른다.
 */
export async function ensurePlan(db: D1Database, settings: Settings, date: string): Promise<PlanRow> {
  const row = await readPlan(db, date);
  if (row && row.fresh !== '') return parsePlan(row)!;
  const extra = Number(row?.extra ?? 0) || 0;
  const introduced = await db
    .prepare('SELECT count(*) AS n FROM cards WHERE introduced_at >= ?')
    .bind(studyDayStartUtc(date))
    .first<{ n: number }>();
  const n = Math.max(0, settings.new_per_day + extra - Number(introduced?.n ?? 0));
  const ids = n ? (await freshCandidates(db, settings, n, [], await lemmasOf(db, [], studyDayStartUtc(date)))).map((r) => r.id) : [];
  await db.batch([
    row
      ? db.prepare("UPDATE day_plans SET fresh = ? WHERE day = ? AND fresh = ''").bind(JSON.stringify(ids), date)
      : db
          .prepare('INSERT INTO day_plans(day, fresh, extra, created_at) VALUES (?, ?, 0, ?) ON CONFLICT(day) DO NOTHING')
          .bind(date, JSON.stringify(ids), new Date().toISOString()),
    db.prepare('DELETE FROM day_plans WHERE day < ?').bind(addDays(date, -PLAN_KEEP_DAYS)),
  ]);
  // 다시 읽어 먼저 적힌 쪽을 쓴다. 그사이 다른 쪽이 다시 정하라고 비웠으면(드묾) 방금 고른 목록 그대로
  const again = await readPlan(db, date);
  return again && again.fresh !== '' ? parsePlan(again)! : { fresh: ids, extra };
}

/** 「새 단어 더 받기」(D3): 오늘 목록 뒤에 EXTRA_STEP 개. 하루 EXTRA_MAX 까지. 두 기기가 동시에 눌러도 한 번만(비교 후 쓰기) */
export async function addExtra(db: D1Database, settings: Settings, now: Date = new Date()): Promise<{ added: number }> {
  const date = studyDay(now);
  for (let attempt = 0; attempt < 2; attempt++) {
    const plan = await ensurePlan(db, settings, date);
    const room = Math.min(EXTRA_STEP, EXTRA_MAX - plan.extra);
    if (room <= 0) throw bad('extra_max');
    const ids = (await freshCandidates(db, settings, room, plan.fresh, await lemmasOf(db, plan.fresh, studyDayStartUtc(date)))).map((r) => r.id);
    if (!ids.length) return { added: 0 };
    const r = await db
      .prepare('UPDATE day_plans SET fresh = ?, extra = extra + ? WHERE day = ? AND extra = ? AND fresh = ?')
      .bind(JSON.stringify([...plan.fresh, ...ids]), ids.length, date, plan.extra, JSON.stringify(plan.fresh))
      .run();
    if (r.meta.changes) return { added: ids.length };
  }
  return { added: 0 };
}

/** 설정(하루 새 단어 수 · 레벨)이 바뀌면 오늘 목록을 비운다 → 다음에 열 때 새 설정으로 다시 정함(더 받은 수는 그대로) */
export function dropPlan(db: D1Database, now: Date = new Date()) {
  return db.prepare("UPDATE day_plans SET fresh = '' WHERE day = ?").bind(studyDay(now));
}

export interface TodayPlan {
  /** 오늘 몫 전체 = 끝낸 카드 + 남은 카드 */
  total: number;
  /** 오늘 채점해서 오늘 안에는 다시 안 나오는 카드 수 */
  done: number;
  /** 오늘 목록의 새 단어 수(복습만이면 0) */
  fresh_total: number;
  extra: number;
  extra_max: number;
}

/**
 * 오늘 몫(F1) = 오늘 학습일이 끝나기 전(다음 날 04:00 KST)에 마감되는 복습 전부 + 오늘 목록의 새 단어 중 아직 안 본 것.
 * 예전엔 「지금까지 마감된 복습」(due <= now)이라 낮·저녁에 카드가 하나씩 풀려 하루 2~3번 덱이 다시 찼다(2026-10-26 실측).
 * 색인: cards_state_due(복습), words PK(새 단어 id), reviews_time·cards_introduced(오늘 수).
 */
export async function buildToday(db: D1Database, settings: Settings, now: Date = new Date()): Promise<Today> {
  await wakeSuspended(db, now);
  const date = studyDay(now);
  const dayStart = studyDayStartUtc(date);
  const dayEnd = studyDayStartUtc(addDays(date, 1));
  const plan = await ensurePlan(db, settings, date);
  const ids = JSON.stringify(plan.fresh);
  const [newDone, reviewed, due, fresh, done, rated] = await db.batch([
    db.prepare('SELECT count(*) AS n FROM cards WHERE introduced_at >= ?').bind(dayStart),
    // 오늘 채점 수 · 좋음/다시 = 덱 채점만. 연습에서 틀려 「다시」 된 줄(session_id practice)은 빼고 센다(검토 반영 2026-10-27)
    db.prepare(`SELECT count(*) AS n FROM reviews WHERE reviewed_at >= ? AND undone = 0 AND session_id IS NOT '${PRACTICE_SESSION}'`).bind(dayStart),
    // state != 0 대신 IN (1,2,3): (state, due) 색인을 세 번 타게 하려고
    db
      .prepare(
        `SELECT ${ITEM_SELECT} FROM cards c JOIN words w ON w.id = c.word_id
         WHERE c.state IN (1, 2, 3) AND c.suspended = 0 AND c.due < ?
         ORDER BY c.due LIMIT ?`,
      )
      .bind(dayEnd, DUE_MAX),
    db
      .prepare(
        `SELECT ${ITEM_SELECT} FROM cards c JOIN words w ON w.id = c.word_id
         WHERE w.id IN (SELECT value FROM json_each(?)) AND c.state = 0 AND c.suspended = 0`,
      )
      .bind(ids),
    // 끝낸 카드 = 오늘 채점했고 지금은 오늘 안에 다시 볼 일이 없는 카드
    db
      .prepare(
        `SELECT count(DISTINCT r.word_id) AS n,
                count(DISTINCT CASE WHEN r.session_id IS NOT '${PRACTICE_SESSION}' THEN r.word_id END) AS deck
         FROM reviews r JOIN cards c ON c.word_id = r.word_id
         WHERE r.reviewed_at >= ? AND r.undone = 0 AND NOT (c.state IN (1, 2, 3) AND c.suspended = 0 AND c.due < ?)`,
      )
      .bind(dayStart, dayEnd),
    db
      .prepare(
        `SELECT coalesce(sum(rating >= 3), 0) AS good, coalesce(sum(rating <= 2), 0) AS again FROM reviews
         WHERE reviewed_at >= ? AND undone = 0 AND session_id IS NOT '${PRACTICE_SESSION}'`,
      )
      .bind(dayStart),
  ]);
  const new_done_today = (newDone.results[0] as { n: number }).n;
  const reviewed_today = (reviewed.results[0] as { n: number }).n;
  // 오늘은 복습만(B6)이면 새 카드 0 — 목록은 남겨 둬 「새 단어 오늘 받기」로 되돌릴 수 있다
  const reviewOnly = settings.review_only_day === date;
  const order = new Map(plan.fresh.map((id, i) => [id, i]));
  // 밀린 복습 = 지금 남은 복습 + 오늘 덱에서 끝낸 복습(하루 중 값이 흔들리지 않게). 더 받은 새 단어(extra)는 줄이지 않는다.
  // 오늘 처음 배워 아직 익히는 중(state 1)인 카드와 연습 오답(내일로 미룬 것)은 세지 않는다 — 새 단어를 할수록 몫이 줄지 않게
  const dueReviews = due.results.filter((r) => Number((r as { state?: number }).state) !== 1).length;
  const backlog = dueReviews + Math.max(0, Number((done.results[0] as { deck: number }).deck) - new_done_today);
  const freshRoom = Math.max(0, freshAllowance(settings.new_per_day, backlog) + plan.extra - new_done_today);
  const freshItems = reviewOnly
    ? []
    : fresh.results
        .map((r) => rowToItem(r as Record<string, unknown>))
        .sort((a, b) => (order.get(a.word.id) ?? 0) - (order.get(b.word.id) ?? 0))
        .slice(0, freshRoom);
  // 기억률 낮은 순(가장 잊어 가는 카드 먼저). 같으면 마감이 이른 순(SQL 순서 유지)
  const dueItems = due.results
    .map((r) => rowToItem(r as Record<string, unknown>))
    .map((it, i) => ({ it, i, r: retrievability(it.card, now) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.it);
  const doneN = (done.results[0] as { n: number }).n;
  const r = rated.results[0] as { good: number; again: number };
  return {
    date,
    day_end: dayEnd,
    due: dueItems,
    fresh: freshItems,
    new_done_today,
    reviewed_today,
    plan: {
      total: doneN + dueItems.length + freshItems.length,
      done: doneN,
      fresh_total: reviewOnly ? 0 : Math.min(plan.fresh.length, freshRoom + new_done_today),
      extra: plan.extra,
      extra_max: EXTRA_MAX,
    },
    ratings: { good: Number(r.good) || 0, again: Number(r.again) || 0 },
  };
}
