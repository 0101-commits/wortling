// 카드 정기 검토 · 뉴스 단어 · 신고 · 내가 넣은 단어 — DB 함수(설계 docs/superpowers/specs/2026-10-15-word-review-news-design.md).
// index.ts 처리기는 요청을 풀어 여기로 넘기기만 한다. 시험: tests/words-db.test.mjs(node:sqlite D1 흉내).
import type { AdminWordsRequest, ChangeItem, ReviewQueueItem, ReviewStats, WordRequestItem } from '../shared/api.ts';
import { REQ_TEXT } from '../shared/request.ts';
import { levelsFor, loadSettings } from './deck.ts';
import { HttpError, bad } from './http.ts';
import { addDays, kstDay } from './time.ts';

const DAY = 86_400_000;
const LEVELS = new Set(['B1', 'B2', 'C1']);
const GENDERS = new Set(['der', 'die', 'das']);
const GLOSS_STATUS = new Set(['generated', 'checked', 'mine']);
const LEVEL_SRC = new Set(['goethe', 'wordhoard', 'news', 'mine']);
const TEXT_FIELDS = ['gloss_ko', 'example_de', 'example_ko', 'scene_en', 'gloss_status', 'example_src', 'gender', 'plural', 'level'] as const;
const CHANGE_FIELDS = new Set(['gloss_ko', 'example_de', 'example_ko', 'gender', 'plural', 'level', 'note']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 열쇠 = 기본형|품사, 앞의 sich 는 뺀다(대소문자 그대로). scripts/words/lib.mjs 의 wordKey 와 같은 규칙 */
export const KEY_SQL = "(CASE WHEN w.lemma LIKE 'sich %' THEN substr(w.lemma, 6) ELSE w.lemma END) || '|' || w.pos";
const LEVEL_ORDER = "CASE w.level WHEN 'B1' THEN 1 WHEN 'B2' THEN 2 ELSE 3 END";
/** D1·node:sqlite 줄 → 보통 객체 */
const plain = (r: unknown) => ({ ...(r as Record<string, unknown>) });
const str = (x: unknown, max: number) => (x == null ? null : String(x).slice(0, max));

// ---------- 고치기(기록 포함) ----------

/** 칸 고치기. 검토(review.mjs) · 글 채우기(daily.mjs) · 순위(news.mjs)가 같이 쓴다. 준 칸만 바꾼다. */
export async function patchWords(db: D1Database, items: AdminWordsRequest['items'] | undefined, now = new Date()) {
  if (!Array.isArray(items) || items.length > 500) throw bad('bad_request');
  const at = now.toISOString();
  const stmts: D1PreparedStatement[] = [];
  const wordStmt = new Set<number>();
  let changes = 0;
  for (const it of items) {
    if (typeof it?.id !== 'string') throw bad('bad_item');
    const sets: string[] = [];
    const binds: unknown[] = [];
    const put = (k: string, v: unknown) => {
      sets.push(`${k} = ?`);
      binds.push(v);
    };
    for (const k of TEXT_FIELDS) {
      const v = it[k];
      if (v === undefined) continue;
      if (typeof v !== 'string') throw bad(`${k} must be string`);
      if (k === 'gloss_status' && !GLOSS_STATUS.has(v)) throw bad('bad gloss_status');
      if (k === 'gender' && v !== '' && !GENDERS.has(v)) throw bad('bad gender');
      if (k === 'level' && !LEVELS.has(v)) throw bad('bad level');
      put(k, (k === 'gender' || k === 'plural') && v === '' ? null : v);
    }
    // 예전 규칙(daily.mjs): 뜻이 오면 generated, 예문이 오면 gen
    if (it.gloss_ko !== undefined && it.gloss_status === undefined) put('gloss_status', 'generated');
    if (it.example_de !== undefined && it.example_src === undefined) put('example_src', 'gen');
    if (it.news_rank !== undefined) {
      if (it.news_rank !== null && !(Number.isInteger(it.news_rank) && it.news_rank > 0)) throw bad('bad news_rank');
      put('news_rank', it.news_rank);
    }
    if (it.checked) put('checked_at', at);
    if (it.image_reset) sets.push("image_status = 'none'");
    if (sets.length) {
      wordStmt.add(stmts.length);
      stmts.push(db.prepare(`UPDATE words SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, it.id));
    }
    if (it.close_reports) stmts.push(db.prepare('UPDATE word_reports SET closed_at = ? WHERE word_id = ? AND closed_at IS NULL').bind(at, it.id));
    for (const c of it.changes ?? []) {
      if (!c || !CHANGE_FIELDS.has(c.field) || (c.applied !== 0 && c.applied !== 1)) throw bad('bad change');
      stmts.push(
        db.prepare('INSERT INTO word_changes(word_id, field, old, new, why, source, applied, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(it.id, c.field, str(c.old, 300), str(c.new, 300), str(c.why, 300), c.source === 'report' ? 'report' : 'review', c.applied, at),
      );
      changes++;
    }
  }
  const results = stmts.length ? await db.batch(stmts) : [];
  const updated = results.reduce((n, r, i) => n + (wordStmt.has(i) ? (r.meta.changes ?? 0) : 0), 0);
  return { updated, changes };
}

// ---------- 넣기 · 열쇠 · 뺀 후보 ----------

const INSERT_COLS = ['lemma', 'pos', 'gender', 'plural', 'ipa', 'level', 'level_src', 'gloss_en', 'gloss_ko', 'gloss_status',
  'example_de', 'example_ko', 'example_src', 'scene_en', 'freq_rank', 'news_rank', 'pinned'] as const;

/** 새 단어 넣기: id·seq 는 지금 끝 번호에서 이어 매기고 카드(state 0)도 같이 만든다. 같은 (lemma,pos) 는 건너뜀. */
export async function insertWords(db: D1Database, items: Array<Record<string, unknown>> | undefined) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) throw bad('items 1..200');
  for (const it of items) {
    if (typeof it.lemma !== 'string' || !it.lemma.trim() || typeof it.pos !== 'string') throw bad('lemma/pos required');
    if (!LEVELS.has(String(it.level))) throw bad('level must be B1|B2|C1');
    if (!LEVEL_SRC.has(String(it.level_src))) throw bad('bad level_src');
  }
  const top = await db.prepare('SELECT max(CAST(substr(id, 2) AS INTEGER)) AS n, max(seq) AS s FROM words').first<{ n: number | null; s: number | null }>();
  let n = top?.n ?? 0;
  let seq = top?.s ?? 0;
  const have = new Set((await db.prepare('SELECT lemma, pos FROM words').all<{ lemma: string; pos: string }>()).results.map((r) => `${r.lemma}|${r.pos}`));
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  let first: string | null = null;
  let last: string | null = null;
  for (const it of items) {
    const k = `${it.lemma}|${it.pos}`;
    if (have.has(k)) continue;
    have.add(k);
    n += 1;
    seq += 1;
    const id = `w${String(n).padStart(4, '0')}`;
    first ??= id;
    last = id;
    const vals: unknown[] = INSERT_COLS.map((c) => (it[c] === undefined || it[c] === '' ? null : it[c]));
    vals[INSERT_COLS.indexOf('gloss_status')] ??= it.gloss_ko ? 'generated' : 'missing';
    vals[INSERT_COLS.indexOf('pinned')] = it.pinned ? 1 : 0;
    stmts.push(
      db.prepare(`INSERT INTO words(id, seq, image_status, ${INSERT_COLS.join(', ')}) VALUES (?, ?, 'none', ${INSERT_COLS.map(() => '?').join(', ')})`).bind(id, seq, ...vals),
      db.prepare('INSERT INTO cards(word_id, state, due) VALUES (?, 0, ?)').bind(id, now),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return { inserted: stmts.length / 2, first_id: first, last_id: last };
}

/** 정기 작업용: 있는 단어 열쇠(+ 뉴스 순위) · 후보에서 뺀 기본형 */
export async function wordKeys(db: D1Database) {
  const [w, s] = await db.batch([db.prepare('SELECT id, lemma, pos, news_rank FROM words ORDER BY id'), db.prepare('SELECT key FROM word_skips ORDER BY key')]);
  return { items: w.results.map(plain), skips: (s.results as Array<{ key: string }>).map((r) => r.key) };
}

export async function putSkips(db: D1Database, items: Array<{ key?: unknown; reason?: unknown }> | undefined, now = new Date()) {
  if (!Array.isArray(items) || items.length > 400) throw bad('bad_request');
  const stmts = items.map((it) => {
    if (typeof it?.key !== 'string' || !/^[^|]{1,60}\|[a-z]+$/.test(it.key)) throw bad('bad item');
    return db.prepare('INSERT INTO word_skips(key, reason, at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING').bind(it.key, str(it.reason, 100), now.toISOString());
  });
  if (stmts.length) await db.batch(stmts);
  return { ok: true as const, count: stmts.length };
}

// ---------- 검토할 줄 ----------

const REVIEW_COLS = `w.id, w.lemma, w.pos, w.gender, w.plural, w.level, w.gloss_ko, w.gloss_status, w.example_de, w.example_ko, w.checked_at,
  (SELECT group_concat(DISTINCT x.field) FROM word_changes x WHERE x.word_id = w.id AND x.reverted_at IS NOT NULL) AS reverted`;

/** 검토할 단어: 열린 신고 → 앞으로 14일 안 새 카드 → 3일 안 복습 → 안 본 것(seq) → 180일 지난 것. 최근 검토는 빠진다. */
export async function reviewQueue(db: D1Database, limit: number, now = new Date()): Promise<ReviewQueueItem[]> {
  const s = await loadSettings(db);
  const lv = levelsFor(s.level);
  const inLevel = `(w.level IN (${lv.map(() => '?').join(', ')}) OR w.pinned = 1)`;
  const stale = new Date(now.getTime() - 180 * DAY).toISOString();
  const soon = new Date(now.getTime() + 3 * DAY).toISOString();
  const notFresh = '(w.checked_at IS NULL OR w.checked_at < ?)';
  const parts = await db.batch([
    db.prepare(`SELECT ${REVIEW_COLS}, r.kind AS report_kind, r.note AS report_note
      FROM word_reports r JOIN words w ON w.id = r.word_id WHERE r.closed_at IS NULL ORDER BY r.created_at LIMIT ?`).bind(limit),
    db.prepare(`SELECT ${REVIEW_COLS} FROM (
        SELECT w.* FROM words w JOIN cards c ON c.word_id = w.id
        WHERE c.state = 0 AND c.suspended = 0 AND ${inLevel} ORDER BY w.pinned DESC, w.seq LIMIT ?
      ) w WHERE ${notFresh}`).bind(...lv, 14 * s.new_per_day, stale),
    db.prepare(`SELECT ${REVIEW_COLS} FROM words w JOIN cards c ON c.word_id = w.id
      WHERE c.state IN (1, 2, 3) AND c.suspended = 0 AND c.due < ? AND ${notFresh} ORDER BY c.due LIMIT ?`).bind(soon, stale, limit),
    db.prepare(`SELECT ${REVIEW_COLS} FROM words w WHERE w.checked_at IS NULL ORDER BY w.seq LIMIT ?`).bind(limit),
    db.prepare(`SELECT ${REVIEW_COLS} FROM words w WHERE w.checked_at < ? ORDER BY w.checked_at LIMIT ?`).bind(stale, limit),
  ]);
  const out: ReviewQueueItem[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const r of part.results as Array<Record<string, unknown>>) {
      if (out.length >= limit) return out;
      const id = String(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const t = (k: string) => (r[k] == null ? null : String(r[k]));
      out.push({
        id,
        lemma: String(r.lemma),
        pos: r.pos as ReviewQueueItem['pos'],
        gender: t('gender'),
        plural: t('plural'),
        level: r.level as ReviewQueueItem['level'],
        gloss_ko: t('gloss_ko'),
        gloss_status: String(r.gloss_status),
        example_de: t('example_de'),
        example_ko: t('example_ko'),
        checked_at: t('checked_at'),
        reverted: r.reverted ? String(r.reverted).split(',') : [],
        report: r.report_kind ? { kind: String(r.report_kind), note: t('report_note') } : null,
      });
    }
  }
  return out;
}

// ---------- 학습 순서 ----------

/** 최근 30일 뉴스 수를 다시 세고, 아직 안 배운 카드의 seq 를 다시 매긴다. 배운 카드는 건드리지 않는다. */
export async function reseq(db: D1Database, now = new Date()) {
  const since = addDays(kstDay(now), -29); // 오늘 포함 30일
  const [h, m] = await db.batch([
    db.prepare(`UPDATE words SET news_hits30 = x.h FROM (
        SELECT w.id, coalesce((SELECT sum(d.n) FROM news_days d WHERE d.key = ${KEY_SQL} AND d.day >= ?), 0) AS h FROM words w
      ) x WHERE words.id = x.id AND words.news_hits30 != x.h`).bind(since),
    db.prepare(`UPDATE words SET seq = x.rn FROM (
        SELECT w.id,
          (SELECT coalesce(max(w2.seq), 0) FROM words w2 JOIN cards c2 ON c2.word_id = w2.id WHERE c2.state != 0 OR c2.introduced_at IS NOT NULL)
          + row_number() OVER (ORDER BY w.pinned DESC, ${LEVEL_ORDER}, (w.news_hits30 >= 2) DESC,
              w.news_rank IS NULL, w.news_rank, w.freq_rank IS NULL, w.freq_rank, w.lemma) AS rn
        FROM words w JOIN cards c ON c.word_id = w.id WHERE c.state = 0 AND c.introduced_at IS NULL
      ) x WHERE words.id = x.id AND words.seq != x.rn`),
  ]);
  return { hits: h.meta.changes ?? 0, moved: m.meta.changes ?? 0 };
}

// ---------- 뉴스 수 ----------

/** 그날 기본형별 기사 수(같은 날·열쇠면 덮어씀) + 60일 지난 줄 지우기. 글은 받지 않는다. */
export async function putNews(db: D1Database, day: unknown, items: Array<{ key?: unknown; n?: unknown; url?: unknown }> | undefined) {
  if (typeof day !== 'string' || !DAY_RE.test(day)) throw bad('bad day');
  if (!Array.isArray(items) || items.length > 400) throw bad('bad_request');
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    const okUrl = it?.url == null || (typeof it.url === 'string' && it.url.length <= 500 && it.url.startsWith('https://'));
    if (typeof it?.key !== 'string' || !/^[^|]{1,60}\|[a-z]+$/.test(it.key) || !Number.isInteger(it.n) || (it.n as number) < 1 || !okUrl) throw bad('bad item');
    stmts.push(
      db.prepare('INSERT INTO news_days(day, key, n, url) VALUES (?, ?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET n = excluded.n, url = excluded.url')
        .bind(day, it.key, it.n, (it.url as string | null | undefined) ?? null),
    );
  }
  stmts.push(db.prepare('DELETE FROM news_days WHERE day < ?').bind(addDays(day, -60)));
  await db.batch(stmts);
  return { ok: true as const, count: items.length };
}

/** since 부터 기본형별 합 + 가장 최근 링크 */
export async function getNews(db: D1Database, since: string) {
  if (!DAY_RE.test(since)) throw bad('bad since');
  const r = await db.prepare(`SELECT d.key, sum(d.n) AS n,
      (SELECT d2.url FROM news_days d2 WHERE d2.key = d.key AND d2.url IS NOT NULL ORDER BY d2.day DESC LIMIT 1) AS url
    FROM news_days d WHERE d.day >= ? GROUP BY d.key ORDER BY n DESC, d.key`).bind(since).all<{ key: string; n: number; url: string | null }>();
  return r.results.map((x) => ({ key: x.key, n: Number(x.n), url: x.url ?? null }));
}

// ---------- 앱: 신고 · 단어 넣기 · 고친 카드 ----------

const REPORT_KINDS = new Set(['meaning', 'example', 'gender', 'level', 'image', 'other']);
const REQUEST_DONE = new Set(['added', 'exists', 'rejected']);
const REVERTIBLE = new Set(['gloss_ko', 'example_de', 'example_ko', 'gender', 'plural', 'level']);

/** 「이상해요」 — 다음 검토 때 맨 먼저 본다 */
export async function addReport(db: D1Database, wordId: string, body: { kind?: unknown; note?: unknown } | null, now = new Date()) {
  const kind = String(body?.kind ?? '');
  if (!REPORT_KINDS.has(kind)) throw bad('bad kind');
  const note = body?.note == null ? null : String(body.note).trim().slice(0, 200) || null;
  if (!(await db.prepare('SELECT id FROM words WHERE id = ?').bind(wordId).first())) throw new HttpError(404, 'not_found');
  const r = await db.prepare('INSERT INTO word_reports(word_id, kind, note, created_at) VALUES (?, ?, ?, ?)').bind(wordId, kind, note, now.toISOString()).run();
  return { ok: true as const, id: Number(r.meta.last_row_id) };
}

/** 「단어 넣기」 — 다음 새벽 작업(news.mjs)이 카드로 만든다. 같은 글이 대기 중이면 그 번호 */
export async function addRequest(db: D1Database, body: { text?: unknown; url?: unknown } | null, now = new Date()) {
  const text = typeof body?.text === 'string' ? body.text.trim().replace(/\s+/g, ' ') : '';
  if (!REQ_TEXT.test(text)) throw bad('bad_text');
  let url: string | null = null;
  if (body?.url != null && body.url !== '') {
    if (typeof body.url !== 'string' || body.url.length > 500 || !body.url.startsWith('https://')) throw bad('bad_url');
    try {
      new URL(body.url);
    } catch {
      throw bad('bad_url');
    }
    url = body.url;
  }
  const dup = await db.prepare("SELECT id FROM word_requests WHERE status = 'queued' AND text = ?").bind(text).first<{ id: number }>();
  if (dup) return { ok: true as const, id: Number(dup.id), duplicate: true };
  const r = await db.prepare('INSERT INTO word_requests(text, url, created_at) VALUES (?, ?, ?)').bind(text, url, now.toISOString()).run();
  return { ok: true as const, id: Number(r.meta.last_row_id), duplicate: false };
}

/** status 를 주면 그 상태만 오래된 순(작업용), 안 주면 최근 순(앱) */
export async function listRequests(db: D1Database, status: string | undefined, limit: number): Promise<WordRequestItem[]> {
  const r = await db.prepare(`SELECT q.id, q.text, q.url, q.created_at, q.status, q.word_id, w.lemma, q.note
      FROM word_requests q LEFT JOIN words w ON w.id = q.word_id
      ${status ? 'WHERE q.status = ?' : ''} ORDER BY q.id ${status ? 'ASC' : 'DESC'} LIMIT ?`)
    .bind(...(status ? [status, limit] : [limit]))
    .all();
  return r.results.map((x) => plain(x) as unknown as WordRequestItem);
}

/** 넣은 단어 처리 결과. added·exists 면 그 단어를 새 카드 맨 앞(pinned)으로 */
export async function settleRequest(db: D1Database, id: number, body: { status?: unknown; word_id?: unknown; note?: unknown } | null) {
  const status = String(body?.status ?? '');
  if (!REQUEST_DONE.has(status)) throw bad('bad status');
  const wordId = typeof body?.word_id === 'string' ? body.word_id : null;
  if (status !== 'rejected' && !wordId) throw bad('word_id required');
  const cur = await db.prepare('SELECT status FROM word_requests WHERE id = ?').bind(id).first<{ status: string }>();
  if (!cur) throw new HttpError(404, 'not_found');
  if (cur.status !== 'queued') throw new HttpError(409, 'not_queued');
  const stmts = [db.prepare('UPDATE word_requests SET status = ?, word_id = ?, note = ? WHERE id = ?').bind(status, wordId, str(body?.note, 100), id)];
  if (wordId) stmts.push(db.prepare('UPDATE words SET pinned = 1 WHERE id = ?').bind(wordId));
  await db.batch(stmts);
  return { ok: true as const };
}

/** 고친 카드(최근 순) — 「확인 필요」(applied 0)도 같이 */
export async function listChanges(db: D1Database, limit: number): Promise<ChangeItem[]> {
  const r = await db.prepare(`SELECT x.id, x.word_id, w.lemma, x.field, x.old, x.new, x.why, x.source, x.applied, x.reverted_at, x.at
      FROM word_changes x JOIN words w ON w.id = x.word_id ORDER BY x.id DESC LIMIT ?`).bind(limit).all();
  return r.results.map((x) => plain(x) as unknown as ChangeItem);
}

/** 되돌리기: 지금 값이 그 고침의 새 값일 때만(그 뒤 또 바뀌었으면 409) */
export async function revertChange(db: D1Database, id: number, now = new Date()) {
  const c = await db.prepare('SELECT word_id, field, old, new, applied, reverted_at FROM word_changes WHERE id = ?').bind(id)
    .first<{ word_id: string; field: string; old: string | null; new: string | null; applied: number; reverted_at: string | null }>();
  if (!c) throw new HttpError(404, 'not_found');
  if (!c.applied || c.reverted_at || !REVERTIBLE.has(c.field)) throw new HttpError(409, 'not_revertible');
  // c.field 는 REVERTIBLE 안의 이름이라 SQL 에 넣어도 안전
  const cur = await db.prepare(`SELECT ${c.field} AS v FROM words WHERE id = ?`).bind(c.word_id).first<{ v: string | null }>();
  if ((cur?.v ?? null) !== (c.new ?? null)) throw new HttpError(409, 'changed_since');
  await db.batch([
    db.prepare(`UPDATE words SET ${c.field} = ? WHERE id = ?`).bind(c.old, c.word_id),
    db.prepare('UPDATE word_changes SET reverted_at = ? WHERE id = ?').bind(now.toISOString(), id),
  ]);
  return { ok: true as const };
}

/** 주간 요약(일요일 디스코드) */
export async function reviewStats(db: D1Database, now = new Date()): Promise<ReviewStats> {
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const [t, c, ch, add, req] = await db.batch([
    db.prepare('SELECT count(*) AS n FROM words'),
    db.prepare('SELECT count(*) AS n FROM words WHERE checked_at IS NOT NULL'),
    db.prepare('SELECT applied, count(*) AS n FROM word_changes WHERE at >= ? GROUP BY applied').bind(since),
    // words.created_at 은 datetime('now') 꼴(공백) → ISO 를 datetime() 으로 맞춰 비교
    db.prepare("SELECT level_src, count(*) AS n FROM words WHERE created_at >= datetime(?) AND level_src IN ('news', 'mine') GROUP BY level_src").bind(since),
    db.prepare('SELECT count(*) AS n FROM word_requests WHERE created_at >= ?').bind(since),
  ]);
  const n = (r: D1Result) => Number((r.results[0] as { n: number }).n);
  const by = (r: D1Result, k: string) => Object.fromEntries((r.results as Array<Record<string, unknown>>).map((x) => [String(x[k]), Number(x.n)]));
  const chg = by(ch, 'applied');
  const ad = by(add, 'level_src');
  return { total: n(t), checked: n(c), week: { applied: chg['1'] ?? 0, flagged: chg['0'] ?? 0, news: ad.news ?? 0, mine: ad.mine ?? 0, requests: n(req) } };
}
