// 오늘 카드 고르기. GET /api/today 와 아침 알림(cron)이 같은 함수를 쓴다.
import type { CardState, DeckItem, Level, Pos, Settings } from '../shared/api.ts';
import { studyDay, studyDayStartUtc } from './time.ts';

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
  due: DeckItem[];
  fresh: DeckItem[];
  new_done_today: number;
  reviewed_today: number;
}

/**
 * 오늘 복습(due) + 새 단어(fresh) 묶음. 「오늘」은 학습일(새벽 4시 경계, time.ts studyDay).
 * 색인: cards_state_due(복습·새 카드), words_seq(새 단어 순서), reviews_time·cards_introduced(오늘 수).
 */
export async function buildToday(db: D1Database, settings: Settings, now: Date = new Date()): Promise<Today> {
  const date = studyDay(now);
  const dayStart = studyDayStartUtc(date);
  const levels = levelsFor(settings.level);
  const [newDone, reviewed, due, fresh] = await db.batch([
    db.prepare('SELECT count(*) AS n FROM cards WHERE introduced_at >= ?').bind(dayStart),
    db.prepare('SELECT count(*) AS n FROM reviews WHERE reviewed_at >= ? AND undone = 0').bind(dayStart),
    // state != 0 대신 IN (1,2,3): (state, due) 색인을 세 번 타게 하려고
    db
      .prepare(
        `SELECT ${ITEM_SELECT} FROM cards c JOIN words w ON w.id = c.word_id
         WHERE c.state IN (1, 2, 3) AND c.suspended = 0 AND c.due <= ?
         ORDER BY c.due LIMIT ?`,
      )
      .bind(now.toISOString(), settings.session_max),
    db
      .prepare(
        `SELECT ${ITEM_SELECT} FROM cards c JOIN words w ON w.id = c.word_id
         WHERE c.state = 0 AND c.suspended = 0 AND w.level IN (${levels.map(() => '?').join(',')})
         ORDER BY w.seq LIMIT ?`,
      )
      .bind(...levels, settings.new_per_day),
  ]);
  const new_done_today = (newDone.results[0] as { n: number }).n;
  const reviewed_today = (reviewed.results[0] as { n: number }).n;
  // 오늘은 복습만(B6)이면 새 카드 0
  const freshLimit = settings.review_only_day === date ? 0 : Math.max(0, settings.new_per_day - new_done_today);
  return {
    date,
    due: due.results.map((r) => rowToItem(r as Record<string, unknown>)),
    fresh: fresh.results.slice(0, freshLimit).map((r) => rowToItem(r as Record<string, unknown>)),
    new_done_today,
    reviewed_today,
  };
}
