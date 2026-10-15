// Wortling Worker: 정적 자산(dist) 앞에서 /api/* 와 /img/* 만 받는다 + cron 두 개.
import type { Env } from './env.ts';
import type {
  AdminWordsRequest,
  Card,
  DeckListResponse,
  InboxItem,
  Level,
  ReviewInput,
  ReviewsRequest,
  ReviewsResponse,
  RunwayResponse,
  Settings,
  StatsResponse,
  TodayResponse,
  WordDetailResponse,
  WordsResponse,
} from '../shared/api.ts';
import { ITEM_SELECT, buildToday, loadSettings, rowToItem } from './deck.ts';
import { applyRating } from './fsrs.ts';
import { DAY_START_H, addDays, studyDay, studyDayStartUtc } from './time.ts';
import { summarize } from './discord.ts';
import type { Payload } from './discord.ts';
import { LATER_MS, WEBHOOK_KEY, WEBHOOK_RE, laterAllowed, sendTest, webhookUrl } from './notify.ts';
import { MAX_SUBS, readSubs, writeSubs } from './push.ts';
import { HttpError, bad } from './http.ts';
import {
  addReport, addRequest, getNews, insertWords, listChanges, listRequests, patchWords, putNews, putSkips,
  reseq, revertChange, reviewQueue, reviewStats, settleRequest, wordKeys,
} from './words.ts';

const json = (data: unknown, status = 200) => Response.json(data, { status });

async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw bad('invalid_json');
  }
}
const intParam = (v: string | null, def: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : def;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const sqlRows = (r: D1Result) => r.results as Record<string, unknown>[];
const count = (r: D1Result) => (r.results[0] as { n: number }).n;

interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: string[];
}
type Handler = (c: Ctx) => Promise<Response>;
/** [메서드, 경로 정규식, 처리기, 공개 여부] */
type Route = [string, RegExp, Handler, boolean?];

// ---------- 처리기 ----------

const health: Handler = async () => json({ ok: true, time: new Date().toISOString() });

const today: Handler = async ({ env }) => {
  const settings = await loadSettings(env.DB);
  const t = await buildToday(env.DB, settings, new Date());
  return json({ ...t, settings } satisfies TodayResponse);
};

/** 채점 묶음 적용. reviewed_at 순으로 처리하고 한 batch 로 원자적으로 쓴다. 같은 (word_id, reviewed_at, session_id) 는 건너뛴다. */
const postReviews: Handler = async ({ req, env }) => {
  const body = await readJson<ReviewsRequest>(req);
  if (!body || typeof body.session_id !== 'string' || !Array.isArray(body.reviews)) throw bad('bad_request');
  if (body.reviews.length > 200) throw bad('too_many_reviews');
  for (const r of body.reviews as ReviewInput[]) {
    if (typeof r?.word_id !== 'string' || !Number.isInteger(r.rating) || r.rating < 1 || r.rating > 4)
      throw bad('bad_review');
    if (Number.isNaN(Date.parse(r.reviewed_at))) throw bad('bad_reviewed_at');
  }
  if (body.reviews.length === 0) return json({ applied: 0, cards: [] } satisfies ReviewsResponse);
  const reviews = [...body.reviews].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
  const ids = [...new Set(reviews.map((r) => r.word_id))];

  // 카드 불러오기(바인딩 100개 상한이라 100개씩) + 이미 적힌 채점(멱등)
  const cards = new Map<string, Card>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { results } = await env.DB.prepare(
      `SELECT * FROM cards WHERE word_id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk)
      .all();
    for (const row of results) cards.set(String(row.word_id), row as unknown as Card);
  }
  for (const id of ids) if (!cards.has(id)) throw new HttpError(404, `unknown word_id ${id}`);
  const first = reviews[0].reviewed_at;
  const last = reviews[reviews.length - 1].reviewed_at;
  const { results: existing } = await env.DB.prepare(
    'SELECT word_id, reviewed_at FROM reviews WHERE reviewed_at BETWEEN ? AND ? AND session_id = ?',
  )
    .bind(first, last, body.session_id)
    .all<{ word_id: string; reviewed_at: string }>();
  const seen = new Set(existing.map((r) => `${r.word_id}|${r.reviewed_at}`));

  const stmts: D1PreparedStatement[] = [];
  const touched = new Set<string>();
  let applied = 0;
  for (const r of reviews) {
    const key = `${r.word_id}|${r.reviewed_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = cards.get(r.word_id)!;
    const { nextRow, log } = applyRating(prev, r.rating, new Date(r.reviewed_at));
    // elapsed_days = 지난 채점 뒤 며칠, scheduled_days = 이번 채점이 정한 다음 간격
    stmts.push(
      env.DB.prepare(
        'INSERT INTO reviews(word_id, rating, reviewed_at, elapsed_days, scheduled_days, session_id, prev_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(r.word_id, r.rating, r.reviewed_at, log.elapsed_days, nextRow.scheduled_days, body.session_id, JSON.stringify(prev)),
    );
    cards.set(r.word_id, nextRow);
    touched.add(r.word_id);
    applied++;
  }
  for (const id of touched) {
    const c = cards.get(id)!;
    stmts.push(
      env.DB.prepare(
        `UPDATE cards SET state = ?, due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
         learning_steps = ?, reps = ?, lapses = ?, last_review = ?, introduced_at = ?, suspended = ? WHERE word_id = ?`,
      ).bind(
        c.state, c.due, c.stability, c.difficulty, c.elapsed_days, c.scheduled_days,
        c.learning_steps, c.reps, c.lapses, c.last_review, c.introduced_at, c.suspended, id,
      ),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ applied, cards: [...touched].map((id) => cards.get(id)!) } satisfies ReviewsResponse);
};

/**
 * 단어 목록. state 뜻: new = 0, learning = 1|3, review = 2(만기 여부 무관), done = 2 이고 안정도 30일 이상.
 * q 는 lemma / gloss_ko / gloss_en 부분 일치(LIKE, 영문은 대소문자 무시).
 */
const words: Handler = async ({ env, url }) => {
  const q = url.searchParams.get('q')?.trim();
  const level = url.searchParams.get('level') ?? 'all';
  const state = url.searchParams.get('state') ?? 'all';
  const page = Math.max(1, intParam(url.searchParams.get('page'), 1));
  const size = clamp(intParam(url.searchParams.get('size'), 50), 1, 200);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(`(w.lemma LIKE ? ESCAPE '\\' OR w.gloss_ko LIKE ? ESCAPE '\\' OR w.gloss_en LIKE ? ESCAPE '\\')`);
    binds.push(like, like, like);
  }
  if (level === 'B1' || level === 'B2' || level === 'C1') {
    where.push('w.level = ?');
    binds.push(level);
  }
  if (state === 'new') where.push('c.state = 0');
  else if (state === 'learning') where.push('c.state IN (1, 3)');
  else if (state === 'review') where.push('c.state = 2'); // 오늘 만기 복습도 포함
  else if (state === 'done') where.push('c.state = 2 AND c.stability >= 30');
  // 정렬(B3): 배운 날짜 = 첫 채점 시각(introduced_at) 최근 순, 가나다 = sich 뺀 표제어
  const sort = url.searchParams.get('sort');
  if (sort === 'learned') where.push('c.introduced_at IS NOT NULL');
  const order =
    sort === 'learned'
      ? 'c.introduced_at DESC, w.seq'
      : sort === 'alpha'
        ? `${ALPHA_KEY}, w.seq`
        : 'w.seq';
  const from = `FROM words w JOIN cards c ON c.word_id = w.id${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
  const [cnt, rows] = await env.DB.batch([
    env.DB.prepare(`SELECT count(*) AS n ${from}`).bind(...binds),
    env.DB.prepare(`SELECT ${ITEM_SELECT} ${from} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, size, (page - 1) * size),
  ]);
  return json({ total: count(cnt), page, size, items: sqlRows(rows).map(rowToItem) } satisfies WordsResponse);
};

/** 가나다 정렬 열쇠: sich 빼고, 움라우트·ß 를 풀고, 소문자(lower 는 ASCII 만이라 Ä 등은 직접) */
const ALPHA_KEY = (() => {
  let e = "CASE WHEN lower(w.lemma) LIKE 'sich %' THEN substr(w.lemma, 6) ELSE w.lemma END";
  for (const [a, b] of [['Ä', 'a'], ['Ö', 'o'], ['Ü', 'u'], ['ä', 'a'], ['ö', 'o'], ['ü', 'u'], ['ß', 'ss']]) e = `replace(${e}, '${a}', '${b}')`;
  return `lower(${e})`;
})();

/** 추가 연습 묶음(B4): 범위 안 배운 카드에서 무작위 n장. today = 오늘 학습일에 본 카드 · week = 최근 7학습일 · all = 배운 카드 전체 */
const drill: Handler = async ({ env, url }) => {
  const scope = url.searchParams.get('scope');
  const n = clamp(intParam(url.searchParams.get('n'), 10), 1, 50);
  const day = studyDay();
  const since = scope === 'today' ? studyDayStartUtc(day) : scope === 'week' ? studyDayStartUtc(addDays(day, -6)) : null;
  const r = await env.DB.prepare(
    `SELECT ${ITEM_SELECT} FROM words w JOIN cards c ON c.word_id = w.id
     WHERE c.state != 0 AND c.suspended = 0${since ? ' AND c.last_review >= ?' : ''} ORDER BY random() LIMIT ?`,
  )
    .bind(...(since ? [since, n] : [n]))
    .all();
  return json({ items: sqlRows(r).map(rowToItem) } satisfies DeckListResponse);
};

/** 관사 1분(B5): 배운 명사(관사 있는 것) 무작위 n개. 모자라면 아직 안 배운 명사를 학습 순서대로 채운다 */
const artikel: Handler = async ({ env, url }) => {
  const n = clamp(intParam(url.searchParams.get('n'), 20), 1, 50);
  const noun = "w.pos = 'noun' AND w.gender IN ('der', 'die', 'das')";
  const seen = await env.DB.prepare(
    `SELECT ${ITEM_SELECT} FROM words w JOIN cards c ON c.word_id = w.id WHERE ${noun} AND c.state != 0 ORDER BY random() LIMIT ?`,
  )
    .bind(n)
    .all();
  const items = sqlRows(seen).map(rowToItem);
  if (items.length < n) {
    const more = await env.DB.prepare(
      `SELECT ${ITEM_SELECT} FROM words w JOIN cards c ON c.word_id = w.id WHERE ${noun} AND c.state = 0 ORDER BY w.seq LIMIT ?`,
    )
      .bind(n - items.length)
      .all();
    items.push(...sqlRows(more).map(rowToItem));
  }
  return json({ items } satisfies DeckListResponse);
};

const wordDetail: Handler = async ({ env, params: [id] }) => {
  const [row, revs] = await env.DB.batch([
    env.DB.prepare(`SELECT ${ITEM_SELECT}, w.scene_en FROM words w JOIN cards c ON c.word_id = w.id WHERE w.id = ?`).bind(id),
    env.DB.prepare(
      'SELECT id, rating, reviewed_at, scheduled_days FROM reviews WHERE word_id = ? ORDER BY reviewed_at DESC LIMIT 20',
    ).bind(id),
  ]);
  const r = row.results[0];
  if (!r) throw new HttpError(404, 'not_found');
  const item = rowToItem(r as Record<string, unknown>);
  return json({ ...item, scene_en: ((r as Record<string, unknown>).scene_en as string | null) ?? null, reviews: revs.results } as WordDetailResponse);
};

const stats: Handler = async ({ env }) => {
  const todayDay = studyDay();
  // ponytail: 열기 지도와 연속일을 한 질의(최근 400일)로. 400일 넘는 연속은 400 으로 보인다.
  const windowStart = studyDayStartUtc(addDays(todayDay, -399));
  const [tw, bl, bs, img, days, dt] = await env.DB.batch([
    env.DB.prepare('SELECT count(*) AS n FROM words'),
    env.DB.prepare('SELECT level, count(*) AS n FROM words GROUP BY level'),
    env.DB.prepare('SELECT state, count(*) AS n FROM cards GROUP BY state'),
    env.DB.prepare("SELECT count(*) AS n FROM words WHERE image_status = 'ok'"),
    env.DB.prepare(
      // 학습일 = 한국 시각 − 4시간의 날짜 → UTC 에 (9 − 4) 시간 더한 날짜
      `SELECT strftime('%Y-%m-%d', reviewed_at, '+${9 - DAY_START_H} hours') AS day, count(*) AS n
       FROM reviews WHERE reviewed_at >= ? AND undone = 0 GROUP BY day ORDER BY day`,
    ).bind(windowStart),
    // 내일 학습일이 끝날 때까지(= 모레 04:00 KST 전) 올 카드
    env.DB.prepare('SELECT count(*) AS n FROM cards WHERE state IN (1, 2, 3) AND due < ?').bind(
      studyDayStartUtc(addDays(todayDay, 2)),
    ),
  ]);
  const byLevel = { B1: 0, B2: 0, C1: 0 } as Record<Level, number>;
  for (const r of bl.results as Array<{ level: Level; n: number }>) if (r.level in byLevel) byLevel[r.level] = r.n;
  const stateName = ['new', 'learning', 'review', 'relearning'] as const;
  const byState = { new: 0, learning: 0, review: 0, relearning: 0 };
  for (const r of bs.results as Array<{ state: number; n: number }>) {
    const k = stateName[r.state];
    if (k) byState[k] = r.n;
  }
  const dayRows = days.results as Array<{ day: string; n: number }>;
  const counts = new Map(dayRows.map((r) => [r.day, r.n]));
  const heat: StatsResponse['heat'] = [];
  for (let i = 83; i >= 0; i--) {
    const day = addDays(todayDay, -i);
    heat.push({ day, count: counts.get(day) ?? 0 });
  }
  // 오늘 또는 어제부터 거슬러 올라가며 끊기지 않는 날 수
  let streak = 0;
  let cursor = counts.has(todayDay) ? todayDay : addDays(todayDay, -1);
  while (counts.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return json({
    total_words: count(tw),
    by_level: byLevel,
    by_state: byState,
    images: count(img),
    heat,
    streak_days: streak,
    due_tomorrow: count(dt),
  } satisfies StatsResponse);
};

const inbox: Handler = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, kind, day, sent_at, opened_at, status, payload_json FROM notifications ORDER BY id DESC LIMIT 30',
  ).all<{
    id: number;
    kind: InboxItem['kind'];
    day: string;
    sent_at: string | null;
    opened_at: string | null;
    status: InboxItem['status'];
    payload_json: string;
  }>();
  const items: InboxItem[] = results.map(({ payload_json, ...r }) => ({
    ...r,
    ...summarize(JSON.parse(payload_json) as Payload),
  }));
  return json({ items });
};

/** 알림을 눌러 앱을 열었다(A4): 링크의 ?n= 을 앱이 보낸다. 처음 한 번만 적는다 */
const openedNotification: Handler = async ({ env, params: [id] }) => {
  const r = await env.DB.prepare(
    'UPDATE notifications SET opened_at = ? WHERE id = ? AND opened_at IS NULL',
  )
    .bind(new Date().toISOString(), Number(id))
    .run();
  return json({ ok: true, updated: r.meta.changes ?? 0 });
};

/**
 * 공개: 폰 알림의 「1시간 뒤」(A2). 서비스 워커는 접속 키가 없어 알림 행의 action_key 로 확인한다.
 * 그날(학습일) 저녁 통이고, 미룬 통이 아직 없고, 1시간 뒤가 23:30 KST 이전일 때만 받는다.
 */
const notifyLater: Handler = async ({ req, env }) => {
  const b = await readJson<{ id?: unknown; key?: unknown }>(req);
  if (!Number.isInteger(b?.id) || typeof b?.key !== 'string') throw bad('bad_request');
  const row = await env.DB.prepare('SELECT kind, day, status, action_key FROM notifications WHERE id = ?')
    .bind(b.id)
    .first<{ kind: string; day: string; status: string; action_key: string | null }>();
  if (!row || !row.action_key || row.action_key !== b.key) throw new HttpError(403, 'forbidden');
  const now = new Date();
  if (row.kind !== 'evening' || row.status !== 'sent' || row.day !== studyDay(now)) return json({ ok: false, error: 'not_tonight' });
  const dup = await env.DB.prepare("SELECT id FROM notifications WHERE kind = 'evening_later' AND day = ?").bind(row.day).first();
  if (dup) return json({ ok: false, error: 'already' });
  if (!laterAllowed(now)) return json({ ok: false, error: 'too_late' });
  const at = now.getTime() + LATER_MS;
  return json(await scheduler(env).later(at));
};

const getSettings: Handler = async ({ env }) => json(await loadSettings(env.DB));

const putSettings: Handler = async ({ req, env }) => {
  const body = await readJson<Partial<Settings>>(req);
  if (!body || typeof body !== 'object') throw bad('bad_request');
  const updates: Array<[string, string]> = [];
  const intIn = (k: 'new_per_day' | 'session_max' | 'evening_min', lo: number, hi: number) => {
    if (!(k in body)) return;
    const v = body[k];
    if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw bad(`${k} must be ${lo}..${hi}`);
    updates.push([k, String(v)]);
  };
  intIn('new_per_day', 1, 20);
  intIn('session_max', 5, 100);
  if ('level' in body) {
    if (body.level !== 'B1' && body.level !== 'B2' && body.level !== 'C1') throw bad('level must be B1|B2|C1');
    updates.push(['level', body.level]);
  }
  if ('swipe_mode' in body) {
    if (body.swipe_mode !== 2 && body.swipe_mode !== 4) throw bad('swipe_mode must be 2|4');
    updates.push(['swipe_mode', String(body.swipe_mode)]);
  }
  if ('vacation_until' in body) {
    const v = body.vacation_until;
    if (typeof v !== 'string' || (v !== '' && Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ) || (v !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v)))
      throw bad('vacation_until must be YYYY-MM-DD or empty');
    updates.push(['vacation_until', v]);
  }
  if ('onboarded' in body) {
    if (typeof body.onboarded !== 'boolean') throw bad('onboarded must be boolean');
    updates.push(['onboarded', body.onboarded ? '1' : '0']);
  }
  if ('evening_mode' in body) {
    if (body.evening_mode !== 'none_today' && body.evening_mode !== 'any_left') throw bad('evening_mode must be none_today|any_left');
    updates.push(['evening_mode', body.evening_mode]);
  }
  intIn('evening_min', 1, 30);
  if ('review_only_day' in body) {
    const v = body.review_only_day;
    if (typeof v !== 'string' || (v !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v))) throw bad('review_only_day must be YYYY-MM-DD or empty');
    updates.push(['review_only_day', v]);
  }
  if (updates.length === 0) throw bad('nothing_to_update');
  await env.DB.batch(
    updates.map(([k, v]) =>
      env.DB.prepare(
        "INSERT INTO settings(key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ).bind(k, v),
    ),
  );
  return json(await loadSettings(env.DB));
};

const testNotification: Handler = async ({ env }) => {
  const r = await sendTest(env);
  if ('skipped' in r) return json({ ok: false, status: 'skipped', error: r.skipped });
  return json({ ok: r.ok, status: r.status, error: r.error, discord: r.discord, push: r.push });
};

/** 웹훅 상태(주소는 돌려주지 않음) */
const getWebhook: Handler = async ({ env }) =>
  json({ set: Boolean(await webhookUrl(env)), source: env.DISCORD_WEBHOOK ? 'secret' : (await env.IMG.get(WEBHOOK_KEY)) ? 'app' : null });

/** 설정 화면에서 붙여 넣은 웹훅 저장 → 바로 시험 통. 실패하면 저장한 것을 되돌린다. */
const putWebhook: Handler = async ({ req, env }) => {
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!WEBHOOK_RE.test(url)) throw bad('bad_webhook_url');
  const before = await env.IMG.get(WEBHOOK_KEY);
  await env.IMG.put(WEBHOOK_KEY, url);
  const r = env.DISCORD_WEBHOOK ? null : await sendTest(env);
  // 시험 통은 기기로도 가지만, 웹훅을 남길지는 디스코드 쪽 결과로만 정한다
  const ok = r !== null && 'discord' in r && r.discord.ok;
  if (r !== null && !ok) {
    if (before) await env.IMG.put(WEBHOOK_KEY, before);
    else await env.IMG.delete(WEBHOOK_KEY);
  }
  return json({
    ok,
    status: r === null ? 'secret_in_use' : 'skipped' in r ? 'skipped' : ok ? 'sent' : 'failed',
    error: r && 'discord' in r ? r.discord.error : undefined,
  });
};

// ---------- 웹 푸시 기기 등록(worker/push.ts) ----------

// 구독 열쇠 길이: p256dh = P-256 공개점 65바이트 → 87자, auth = 16바이트 → 22자(base64url)
const P256DH = /^[\w-]{87}=?$/;
const AUTH = /^[\w-]{22}(==)?$/;
const httpsUrl = (s: string) => {
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
};

const pushKey: Handler = async ({ env }) => json({ publicKey: env.VAPID_PUBLIC_KEY });

/** body = PushSubscription.toJSON(). 같은 endpoint 면 덮어쓰고, 10대를 넘으면 오래된 것부터 뺀다 */
const pushSubscribe: Handler = async ({ req, env }) => {
  const b = await readJson<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }>(req);
  const endpoint = b?.endpoint;
  const { p256dh, auth } = b?.keys ?? {};
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !httpsUrl(endpoint)) throw bad('bad_endpoint');
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !P256DH.test(p256dh) || !AUTH.test(auth)) throw bad('bad_keys');
  const subs = (await readSubs(env)).filter((s) => s.endpoint !== endpoint);
  subs.push({ endpoint, keys: { p256dh, auth }, added: new Date().toISOString() });
  const kept = subs.slice(-MAX_SUBS);
  await writeSubs(env, kept);
  return json({ ok: true, count: kept.length });
};

const pushUnsubscribe: Handler = async ({ req, env }) => {
  const b = await readJson<{ endpoint?: unknown }>(req);
  if (typeof b?.endpoint !== 'string') throw bad('bad_endpoint');
  const subs = await readSubs(env);
  const kept = subs.filter((s) => s.endpoint !== b.endpoint);
  if (kept.length !== subs.length) await writeSubs(env, kept);
  return json({ ok: true, count: kept.length });
};

// ---------- 단어 관리(worker/words.ts) ----------

const adminKeys: Handler = async ({ env }) => json(await wordKeys(env.DB));
const adminInsert: Handler = async ({ req, env }) =>
  json(await insertWords(env.DB, (await readJson<{ items?: Array<Record<string, unknown>> }>(req))?.items));
/** 단어 칸 고치기 + 고침 기록(scripts/words/review.mjs) · 글 채우기(daily.mjs) */
const adminWords: Handler = async ({ req, env }) => json(await patchWords(env.DB, (await readJson<AdminWordsRequest>(req))?.items));
const adminReviewQueue: Handler = async ({ env, url }) =>
  json({ items: await reviewQueue(env.DB, clamp(intParam(url.searchParams.get('limit'), 250), 1, 500)) });
const adminReseq: Handler = async ({ env }) => json(await reseq(env.DB));
const adminNewsGet: Handler = async ({ env, url }) => json({ items: await getNews(env.DB, url.searchParams.get('since') ?? '') });
const adminNewsPut: Handler = async ({ req, env }) => {
  const b = await readJson<{ day?: unknown; items?: Array<{ key?: unknown; n?: unknown; url?: unknown }> }>(req);
  return json(await putNews(env.DB, b?.day, b?.items));
};
const adminSkips: Handler = async ({ req, env }) =>
  json(await putSkips(env.DB, (await readJson<{ items?: Array<{ key?: unknown; reason?: unknown }> }>(req))?.items));
const adminRequests: Handler = async ({ env, url }) =>
  json({ items: await listRequests(env.DB, url.searchParams.get('status') ?? undefined, 50) });
const adminSettle: Handler = async ({ req, env, params: [id] }) =>
  json(await settleRequest(env.DB, Number(id), await readJson<Record<string, unknown>>(req)));
const adminReviewStats: Handler = async ({ env }) => json(await reviewStats(env.DB));
const postReport: Handler = async ({ req, env, params: [id] }) => json(await addReport(env.DB, id, await readJson<Record<string, unknown>>(req)));
const getRequests: Handler = async ({ env }) => json({ items: await listRequests(env.DB, undefined, 10) });
const postRequest: Handler = async ({ req, env }) => json(await addRequest(env.DB, await readJson<Record<string, unknown>>(req)));
/** 고친 카드 100개씩, ?before=<번호> 로 더 보기 */
const getChanges: Handler = async ({ env, url }) =>
  json({ items: await listChanges(env.DB, 100, intParam(url.searchParams.get('before'), 0) || undefined) });
const postRevert: Handler = async ({ env, params: [id] }) => json(await revertChange(env.DB, Number(id)));

/** 매일 스크립트가 채울 거리: 글이 비는 단어 / 그림이 없는 단어. 공부 중인 카드 먼저, 그다음 seq. */
const runway: Handler = async ({ env, url }) => {
  const text = clamp(intParam(url.searchParams.get('text'), 60), 0, 500);
  const image = clamp(intParam(url.searchParams.get('image'), 13), 0, 500);
  const order = 'ORDER BY coalesce(c.state, 0) != 0 DESC, w.seq LIMIT ?';
  const [t, i] = await env.DB.batch([
    env.DB.prepare(
      `SELECT w.id, w.lemma, w.pos, w.gender, w.level, w.gloss_en FROM words w LEFT JOIN cards c ON c.word_id = w.id
       WHERE w.gloss_ko IS NULL OR w.example_de IS NULL OR w.scene_en IS NULL ${order}`,
    ).bind(text),
    env.DB.prepare(
      `SELECT w.id, w.lemma, w.pos, w.gender, w.level, w.scene_en FROM words w LEFT JOIN cards c ON c.word_id = w.id
       WHERE w.image_status = 'none' AND w.scene_en IS NOT NULL ${order}`,
    ).bind(image),
  ]);
  return json({ need_text: t.results, need_image: i.results } as RunwayResponse);
};

const MAX_IMAGE_BYTES = 200 * 1024;

/** 그림 올리기(webp 200KB 이하) 또는 ?status=failed 로 실패 표시 */
const putImage: Handler = async ({ req, env, url, params: [id] }) => {
  const word = await env.DB.prepare('SELECT id FROM words WHERE id = ?').bind(id).first();
  if (!word) throw new HttpError(404, 'not_found');
  if (url.searchParams.get('status') === 'failed') {
    await env.DB.prepare("UPDATE words SET image_status = 'failed' WHERE id = ?").bind(id).run();
    return json({ ok: true, status: 'failed' });
  }
  if (!(req.headers.get('content-type') ?? '').startsWith('image/webp')) throw new HttpError(415, 'image/webp only');
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength === 0) throw bad('empty_body');
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'too_large');
  const key = `${id}.webp`;
  await env.IMG.put(key, bytes);
  await env.DB.prepare("UPDATE words SET image_status = 'ok', image_id = ? WHERE id = ?").bind(key, id).run();
  return json({ ok: true, status: 'ok', image_id: key });
};

/**
 * 관리: 그림 한 장 그리기 → jpeg 바이트. 매일 작업(scripts/daily.mjs)·이모티콘(scripts/make-emoji.mjs)이 부른다.
 * Workers AI FLUX.2 klein 4b — 무료 하루 10,000 뉴런, 1024×768 = 출력 3칸 × 26.05 ≈ 78 뉴런 → 하루 ≈ 120장.
 * 2026-10-14 같은 장면으로 비교: Leonardo Phoenix 는 글자·회색 바탕, Lucid Origin 은 장당 ≈ 2,000 뉴런, FLUX.1 schnell 은 정사각만.
 */
const DRAW_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const draw: Handler = async ({ req, env }) => {
  const b = await readJson<{ prompt?: unknown; width?: unknown; height?: unknown; ref?: unknown }>(req);
  if (!b || typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 2000) throw bad('prompt');
  // ref = 참고 그림(png base64, 512² 이하) → input_image_0. 보르티 생김새·그림체를 장마다 같게 묶는다
  if (b.ref !== undefined && (typeof b.ref !== 'string' || b.ref.length > 400_000)) throw bad('ref');
  // 16 의 배수, 256~1536
  const side = (v: unknown, d: number) => Math.min(1536, Math.max(256, Math.round((Number(v) || d) / 16) * 16));
  const form = new FormData();
  if (typeof b.ref === 'string') {
    const s = atob(b.ref);
    const ref = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) ref[i] = s.charCodeAt(i);
    form.append('input_image_0', new Blob([ref], { type: 'image/png' }));
  }
  form.append('prompt', b.prompt);
  form.append('width', String(side(b.width, 1024)));
  form.append('height', String(side(b.height, 768)));
  const body = new Response(form);
  let out: { image?: string } | null;
  try {
    out = (await env.AI.run(DRAW_MODEL, { multipart: { body: body.body, contentType: body.headers.get('content-type') } })) as { image?: string } | null;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // 무료 하루 몫을 다 쓰면 4006(daily free allocation) → 429 로 돌려 매일 작업이 멈추게
    if (/\b4006\b|free allocation/i.test(msg)) throw new HttpError(429, 'quota');
    throw new HttpError(502, msg.slice(0, 300));
  }
  if (!out?.image) throw new HttpError(502, 'no_image');
  // 콜백 없는 반복문 — Uint8Array.from(…, cb) 는 300KB 에 ≈ 17ms 라 무료 플랜 CPU 10ms 를 넘을 수 있음
  const s = atob(out.image);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
};

/** 공개: KV 그림. _default.webp 도 같은 길. */
const getImage: Handler = async ({ env, params: [name] }) => {
  // cacheTtl: 같은 그림을 엣지에 1시간 붙잡아 KV 읽기를 줄인다
  const body = await env.IMG.get(`${name}.webp`, { type: 'stream', cacheTtl: 3600 });
  if (!body) return new Response('not found', { status: 404 });
  return new Response(body, {
    headers: {
      'content-type': 'image/webp',
      // 하루만: 그림은 같은 주소에서 다시 그려진다(그림체 바꾸기 · --redo). 1년 immutable 이면 폰에 예전 그림이 남음
      'cache-control': 'public, max-age=86400',
    },
  });
};

// ---------- 길 찾기 ----------

const routes: Route[] = [
  ['GET', /^\/api\/health$/, health, true],
  ['GET', /^\/img\/([\w-]+)\.webp$/, getImage, true],
  ['GET', /^\/api\/today$/, today],
  ['POST', /^\/api\/reviews$/, postReviews],
  ['GET', /^\/api\/words$/, words],
  ['GET', /^\/api\/drill$/, drill],
  ['GET', /^\/api\/artikel$/, artikel],
  ['GET', /^\/api\/word\/([\w-]+)$/, wordDetail],
  ['POST', /^\/api\/words\/([\w-]+)\/report$/, postReport],
  ['GET', /^\/api\/requests$/, getRequests],
  ['POST', /^\/api\/requests$/, postRequest],
  ['GET', /^\/api\/changes$/, getChanges],
  ['POST', /^\/api\/changes\/(\d+)\/revert$/, postRevert],
  ['GET', /^\/api\/stats$/, stats],
  ['GET', /^\/api\/inbox$/, inbox],
  ['POST', /^\/api\/notifications\/(\d+)\/open$/, openedNotification],
  ['POST', /^\/api\/notify\/later$/, notifyLater, true],
  ['GET', /^\/api\/settings$/, getSettings],
  ['PUT', /^\/api\/settings$/, putSettings],
  ['POST', /^\/api\/test-notification$/, testNotification],
  ['GET', /^\/api\/webhook$/, getWebhook],
  ['PUT', /^\/api\/webhook$/, putWebhook],
  ['GET', /^\/api\/push\/key$/, pushKey],
  ['POST', /^\/api\/push\/subscribe$/, pushSubscribe],
  ['DELETE', /^\/api\/push\/subscribe$/, pushUnsubscribe],
  ['GET', /^\/api\/admin\/runway$/, runway],
  ['POST', /^\/api\/admin\/words$/, adminWords],
  ['PUT', /^\/api\/admin\/image\/([\w-]+)$/, putImage],
  ['POST', /^\/api\/admin\/draw$/, draw],
  ['GET', /^\/api\/admin\/review-queue$/, adminReviewQueue],
  ['POST', /^\/api\/admin\/reseq$/, adminReseq],
  ['GET', /^\/api\/admin\/news$/, adminNewsGet],
  ['POST', /^\/api\/admin\/news$/, adminNewsPut],
  ['POST', /^\/api\/admin\/skips$/, adminSkips],
  ['GET', /^\/api\/admin\/requests$/, adminRequests],
  ['POST', /^\/api\/admin\/requests\/(\d+)$/, adminSettle],
  ['GET', /^\/api\/admin\/review-stats$/, adminReviewStats],
  ['GET', /^\/api\/admin\/keys$/, adminKeys],
  ['POST', /^\/api\/admin\/words\/insert$/, adminInsert],
];

function authed(req: Request, env: Env): boolean {
  return req.headers.get('authorization') === `Bearer ${env.API_TOKEN}`;
}

export { Scheduler } from './alarm.ts';

/** 알림 시계 하나(이름 고정). 알람이 비어 있으면 다시 채운다 */
function scheduler(env: Env) {
  return env.SCHED.get(env.SCHED.idFromName('main'));
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // 앱을 열 때마다 알림 시계가 살아 있는지 확인(비어 있을 때만 예약, 이미 있으면 그대로)
    if (url.pathname === '/api/today') ctx.waitUntil(scheduler(env).ensure().then(() => undefined));
    try {
      if (url.pathname === '/api/admin/schedule' && req.method === 'POST') {
        if (!authed(req, env)) throw new HttpError(401, 'unauthorized');
        const t = Number(url.searchParams.get('test_in') ?? 0);
        return json(t > 0 ? await scheduler(env).testIn(Math.min(t, 600)) : await scheduler(env).ensure());
      }
      let pathMatched = false;
      for (const [method, re, handler, isPublic] of routes) {
        const m = url.pathname.match(re);
        if (!m) continue;
        pathMatched = true;
        if (req.method !== method) continue;
        if (!isPublic && !authed(req, env)) throw new HttpError(401, 'unauthorized');
        return await handler({ req, env, url, params: m.slice(1) });
      }
      throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'method_not_allowed' : 'not_found');
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('unhandled', e);
      return json({ error: 'internal', detail: String(e) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
