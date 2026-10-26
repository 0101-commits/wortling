// 오늘 카드 고르기. GET /api/today 와 아침 알림(cron)이 같은 함수를 쓴다.
import type { CardState, DeckItem, Level, Pos, Settings } from '../shared/api.ts';
import { addDays, studyDay, studyDayStartUtc } from './time.ts';
import { bad } from './http.ts';

/** words w JOIN cards c 에서 DeckItem 을 만들 때 고르는 열(열 이름이 겹치지 않게 w.id / c.word_id) */
export const ITEM_SELECT = `w.id, w.lemma, w.pos, w.gender, w.plural, w.ipa, w.level, w.gloss_en, w.gloss_ko,
  w.example_de, w.example_ko, w.image_status, w.seq,
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

/** 오늘 몫에서 한 번에 보내는 복습 상한(안전장치). 화면은 session_max 씩 끊는다 */
const DUE_MAX = 300;
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

/** 새 단어 후보: 안 배운 카드, 레벨 안(또는 내가 넣은 단어), 학습 순서. except = 이미 고른 id(JSON 배열) */
function freshCandidates(db: D1Database, settings: Settings, n: number, except: string[] = []) {
  const levels = levelsFor(settings.level);
  return db
    .prepare(
      `SELECT w.id FROM cards c JOIN words w ON w.id = c.word_id
       WHERE c.state = 0 AND c.suspended = 0 AND (w.level IN (${levels.map(() => '?').join(',')}) OR w.pinned = 1)
         AND w.id NOT IN (SELECT value FROM json_each(?))
       ORDER BY w.pinned DESC, w.seq, w.lemma LIMIT ?`,
    )
    .bind(...levels, JSON.stringify(except), n)
    .all<{ id: string }>();
}

/**
 * 그날 새 단어 목록(F1·F5). 처음 부를 때(아침 알림 또는 그날 처음 연 앱) 한 번 정해 day_plans 에 적는다.
 * 그 뒤로는 단어 작업이 학습 순서를 다시 매기거나 새 단어를 넣어도 그날 목록은 그대로.
 * 알림과 앱이 동시에 만들어도 ON CONFLICT 로 먼저 적힌 하나만 남는다.
 */
export async function ensurePlan(db: D1Database, settings: Settings, date: string): Promise<PlanRow> {
  const got = parsePlan(await db.prepare('SELECT fresh, extra FROM day_plans WHERE day = ?').bind(date).first<{ fresh: string; extra: number }>());
  if (got) return got;
  const introduced = await db
    .prepare('SELECT count(*) AS n FROM cards WHERE introduced_at >= ?')
    .bind(studyDayStartUtc(date))
    .first<{ n: number }>();
  const n = Math.max(0, settings.new_per_day - Number(introduced?.n ?? 0));
  const ids = n ? (await freshCandidates(db, settings, n)).results.map((r) => r.id) : [];
  await db.batch([
    db
      .prepare('INSERT INTO day_plans(day, fresh, extra, created_at) VALUES (?, ?, 0, ?) ON CONFLICT(day) DO NOTHING')
      .bind(date, JSON.stringify(ids), new Date().toISOString()),
    db.prepare('DELETE FROM day_plans WHERE day < ?').bind(addDays(date, -PLAN_KEEP_DAYS)),
  ]);
  return parsePlan(await db.prepare('SELECT fresh, extra FROM day_plans WHERE day = ?').bind(date).first<{ fresh: string; extra: number }>())!;
}

/** 「새 단어 더 받기」(D3): 오늘 목록 뒤에 EXTRA_STEP 개. 하루 EXTRA_MAX 까지 */
export async function addExtra(db: D1Database, settings: Settings, now: Date = new Date()): Promise<{ added: number }> {
  const date = studyDay(now);
  const plan = await ensurePlan(db, settings, date);
  const room = Math.min(EXTRA_STEP, EXTRA_MAX - plan.extra);
  if (room <= 0) throw bad('extra_max');
  const ids = (await freshCandidates(db, settings, room, plan.fresh)).results.map((r) => r.id);
  if (!ids.length) return { added: 0 };
  await db
    .prepare('UPDATE day_plans SET fresh = ?, extra = extra + ? WHERE day = ?')
    .bind(JSON.stringify([...plan.fresh, ...ids]), ids.length, date)
    .run();
  return { added: ids.length };
}

/** 설정(하루 새 단어 수 · 레벨)이 바뀌면 오늘 목록을 버린다 → 다음에 열 때 새 설정으로 다시 정함 */
export function dropPlan(db: D1Database, now: Date = new Date()) {
  return db.prepare('DELETE FROM day_plans WHERE day = ?').bind(studyDay(now));
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
  const date = studyDay(now);
  const dayStart = studyDayStartUtc(date);
  const dayEnd = studyDayStartUtc(addDays(date, 1));
  const plan = await ensurePlan(db, settings, date);
  const ids = JSON.stringify(plan.fresh);
  const [newDone, reviewed, due, fresh, done, rated] = await db.batch([
    db.prepare('SELECT count(*) AS n FROM cards WHERE introduced_at >= ?').bind(dayStart),
    db.prepare('SELECT count(*) AS n FROM reviews WHERE reviewed_at >= ? AND undone = 0').bind(dayStart),
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
        `SELECT count(DISTINCT r.word_id) AS n FROM reviews r JOIN cards c ON c.word_id = r.word_id
         WHERE r.reviewed_at >= ? AND r.undone = 0 AND NOT (c.state IN (1, 2, 3) AND c.suspended = 0 AND c.due < ?)`,
      )
      .bind(dayStart, dayEnd),
    db
      .prepare('SELECT coalesce(sum(rating >= 3), 0) AS good, coalesce(sum(rating <= 2), 0) AS again FROM reviews WHERE reviewed_at >= ? AND undone = 0')
      .bind(dayStart),
  ]);
  const new_done_today = (newDone.results[0] as { n: number }).n;
  const reviewed_today = (reviewed.results[0] as { n: number }).n;
  // 오늘은 복습만(B6)이면 새 카드 0 — 목록은 남겨 둬 「새 단어 오늘 받기」로 되돌릴 수 있다
  const reviewOnly = settings.review_only_day === date;
  const order = new Map(plan.fresh.map((id, i) => [id, i]));
  const freshItems = reviewOnly
    ? []
    : fresh.results
        .map((r) => rowToItem(r as Record<string, unknown>))
        .sort((a, b) => (order.get(a.word.id) ?? 0) - (order.get(b.word.id) ?? 0));
  const dueItems = due.results.map((r) => rowToItem(r as Record<string, unknown>));
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
      fresh_total: reviewOnly ? 0 : plan.fresh.length,
      extra: plan.extra,
      extra_max: EXTRA_MAX,
    },
    ratings: { good: Number(r.good) || 0, again: Number(r.again) || 0 },
  };
}
