// D1(node:sqlite 흉내) ↔ Postgres(PGlite + worker/db.ts 어댑터) 같은 일 시험(2026-10-30 Supabase 이전).
// 같은 씨앗을 두 DB 에 넣고 Worker 경로를 똑같이 불러 응답 JSON 과 쓴 뒤의 표 내용이 같은지 본다.
// 무작위 순서(drill · artikel · practice)는 수와 id 모음만 비교한다.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { fakeD1, lem } from './d1.mjs';
import { createPgDb, isPg, toPg } from '../worker/db.ts';
import { parseDump, migrate } from '../scripts/db/d1-to-pg.mjs';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(s, e) { this.ctx = s; this.env = e; } }', shortCircuit: true };
  return next(spec, ctx);
}`));
crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));
const { default: worker } = await import('../worker/index.ts');
const { runEvening, runMorning } = await import('../worker/notify.ts');

const SCHEMA = readFileSync(new URL('../scripts/db/schema.pg.sql', import.meta.url), 'utf8');
const PARSERS = { 20: Number, 1700: Number }; // worker/db.ts 의 postgres.js types 와 같게(BIGINT·NUMERIC → 수)

async function pgDb() {
  const pg = new PGlite();
  await pg.exec(SCHEMA);
  const wrap = (q) => async (text, params) => {
    const r = await q.query(text, params, { parsers: PARSERS });
    return Object.assign(r.rows, { count: r.affectedRows ?? 0 });
  };
  const db = createPgDb({ exec: wrap(pg), begin: (fn) => pg.transaction((tx) => fn(wrap(tx))) }, {});
  return { db, pg };
}

const T0 = Math.floor(Date.now() / 60_000) * 60_000; // 두 씨앗이 같은 시각을 쓰게
const iso = (ms) => new Date(T0 + ms).toISOString();
const DAY = 86_400_000;

/** 두 DB 에 같은 씨앗(D1 모양 API 로 넣어 두 방언을 같이 거친다) */
async function seed(db) {
  const words = [];
  for (let i = 0; i < 40; i++) {
    const id = `w${String(i + 1).padStart(4, '0')}`;
    const lemma = i === 3 ? 'sich freuen' : i === 4 ? 'Ärger' : i === 5 ? 'äußern' : lem(i);
    words.push(id);
    await db
      .prepare(`INSERT INTO words(id, lemma, pos, gender, plural, level, level_src, gloss_en, gloss_ko, gloss_status, example_de, example_ko,
        scene_en, image_status, freq_rank, seq, news_rank, news_hits30, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, lemma, i % 3 ? 'noun' : 'verb', i % 3 ? ['der', 'die', 'das'][i % 3] : null, null, ['B1', 'B2', 'C1'][i % 3], 'goethe',
        i % 4 ? `English ${i}` : 'HOUSE thing', i % 7 ? `뜻 ${i}` : null, 'generated', i % 5 ? `Das ist ${lemma} hier.` : null, i % 5 ? '예문' : null,
        i % 6 ? 'scene' : null, i % 2 ? 'ok' : 'none', i % 4 ? 100 + i : null, i < 10 ? 7_999_999_999 - i : 1000 + i, i % 8 ? null : 50 + i, i % 9, i === 7 ? 1 : 0,
        '2026-10-20 01:02:03')
      .run();
    const learned = i >= 20 && i < 32;
    await db
      .prepare(`INSERT INTO cards(word_id, state, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review, introduced_at, suspended)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, learned ? [1, 2, 3][i % 3] : 0, learned ? iso(i === 30 ? 3 * DAY : (i - 26) * 3_600_000) : '2026-10-01T00:00:00.000Z', learned ? 2.5 + i : 0, learned ? 5.25 : 0,
        learned ? 1 : 0, learned ? 2 : 0, learned ? 3 : 0, learned ? i % 6 : 0, learned ? iso(-DAY) : null, learned ? iso(-(i - 19) * 3_600_000) : null, 0)
      .run();
  }
  for (let k = 0; k < 6; k++)
    await db.prepare('INSERT INTO reviews(word_id, rating, reviewed_at, session_id, undone) VALUES (?, ?, ?, ?, 0)')
      .bind(words[20 + k], 1 + (k % 4), iso(-k * DAY - 60_000), k === 2 ? 'practice' : k === 3 ? null : 's1').run();
  await db.prepare("INSERT INTO practice(mode, word_id, correct, at) VALUES ('cloze', ?, 0, ?)").bind(words[21], iso(-3_600_000)).run();
  await db.prepare("INSERT INTO notifications(kind, day, scheduled_at, status, payload_json, action_key) VALUES ('morning', '2026-10-20', ?, 'sent', ?, 'k')")
    .bind(iso(-2 * DAY), JSON.stringify({ flags: 32768, components: [] })).run();
  await db.prepare("INSERT INTO word_changes(word_id, field, old, new, why, applied, at) VALUES (?, 'gloss_ko', '옛', ?, '왜', 1, ?)").bind(words[1], '뜻 1', iso(-DAY)).run();
  await db.prepare("INSERT INTO word_changes(word_id, field, old, new, why, applied, reverted_at, at) VALUES (?, 'level', 'B1', 'B2', '왜', 1, ?, ?)").bind(words[2], iso(-DAY), iso(-2 * DAY)).run();
  for (const [day, key, n] of [['2026-10-25', `${lem(10)}|noun`, 3], ['2026-10-26', `${lem(10)}|noun`, 2], ['2026-10-26', 'freuen|verb', 4]])
    await db.prepare('INSERT INTO news_days(day, key, n, url) VALUES (?, ?, ?, ?)').bind(day, key, n, 'https://x.test/' + day).run();
  await db.prepare("INSERT INTO word_skips(key, reason, at) VALUES ('Leo|noun', '드묾', ?)").bind(iso(0)).run();
  return words;
}

const env = (db) => ({ DB: db, IMG: { get: async () => null, put: async () => undefined }, API_TOKEN: 't', APP_URL: 'https://x.test', SCHED: { idFromName: () => 'x', get: () => ({ ensure: async () => ({}), later: async () => ({ ok: true }) }) } });
async function call(db, method, path, body) {
  const init = { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await worker.fetch(new Request('https://x.test' + path, init), env(db), { waitUntil() {} });
  return { status: res.status, body: await res.json() };
}
// 시각(지금)·무작위는 비교에서 뺀다
const scrub = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'time' ? undefined : v)));

const TABLES = { words: 'id', cards: 'word_id', reviews: 'id', notifications: 'id', settings: 'key', word_changes: 'id', word_reports: 'id', word_requests: 'id', news_days: 'day, key', word_skips: 'key', day_plans: 'day', practice: 'id' };
const DROP = new Set(['created_at', 'updated_at', 'scheduled_at', 'sent_at', 'opened_at', 'action_key', 'payload_json', 'at', 'reviewed_at', 'reverted_at', 'checked_at']);
async function dump(db) {
  const out = {};
  for (const [t, pk] of Object.entries(TABLES)) {
    const { results } = await db.prepare(`SELECT * FROM ${t} ORDER BY ${pk}`).all();
    out[t] = results.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !DROP.has(k)).map(([k, v]) => [k, typeof v === 'number' ? Number(v) : v])));
  }
  return out;
}

test('toPg: 따옴표 밖 ? 만 $n', () => {
  assert.equal(toPg("SELECT ? , '?' , ?"), "SELECT $1 , '?' , $2");
  assert.equal(toPg("a LIKE ? ESCAPE '\\' AND b = ?"), "a LIKE $1 ESCAPE '\\' AND b = $2");
});

test('두 DB: 읽기 경로 응답이 같다', async () => {
  const d1 = fakeD1();
  const { db: pg } = await pgDb();
  assert.ok(isPg(pg) && !isPg(d1));
  await seed(d1);
  await seed(pg);
  const paths = [
    '/api/today', '/api/words', '/api/words?size=7&page=2', '/api/words?size=5&page=4', '/api/words?state=review', '/api/words?state=new&size=10',
    '/api/words?state=learning', '/api/words?state=done', '/api/words?sort=alpha', '/api/words?sort=learned', '/api/words?level=B2',
    '/api/words?q=house', '/api/words?q=%C3%84rger', '/api/words?q=%25', '/api/word/w0021', '/api/word/w0004', '/api/stats', '/api/inbox', '/api/settings',
    '/api/requests', '/api/changes', '/api/admin/runway', '/api/admin/review-queue', '/api/admin/keys', '/api/admin/images', '/api/admin/examples',
    '/api/admin/words-export', '/api/admin/news?since=2026-10-01', '/api/admin/review-stats', '/api/admin/requests?status=queued',
  ];
  for (const p of paths) {
    const a = await call(d1, 'GET', p);
    const b = await call(pg, 'GET', p);
    assert.equal(b.status, 200, `${p} pg ${JSON.stringify(b.body).slice(0, 300)}`);
    assert.deepEqual(scrub(b), scrub(a), p);
  }
  // 무작위 순서 경로: 수와 모음
  for (const p of ['/api/drill?scope=all&n=50', '/api/drill?scope=week&n=50', '/api/artikel?n=50', '/api/practice?scope=all&n=50', '/api/practice?scope=wrong&n=50', '/api/practice?scope=today&n=50']) {
    const ids = (r) => [...(r.body.items ?? []).map((x) => x.word.id)].sort();
    const a = await call(d1, 'GET', p);
    const b = await call(pg, 'GET', p);
    assert.equal(b.status, 200, `${p} pg ${JSON.stringify(b.body).slice(0, 300)}`);
    assert.deepEqual(ids(b), ids(a), p);
    if (a.body.pool) assert.equal(b.body.pool.length, a.body.pool.length, `${p} pool`);
  }
  assert.deepEqual(await dump(pg), await dump(d1));
});

test('두 DB: 쓰기 경로 결과와 표가 같다', async (t) => {
  // 지금 시각으로 적는 칸(at · due …)이 두 DB 에서 같도록 Date 만 멈춘다(타이머는 그대로)
  mock.timers.enable({ apis: ['Date'], now: T0 + 5_000 });
  t.after(() => mock.timers.reset());
  const d1 = fakeD1();
  const { db: pg } = await pgDb();
  const words = await seed(d1);
  await seed(pg);
  const now = Date.now();
  const steps = [
    ['GET', '/api/today'],
    ['POST', '/api/today/more'],
    ['POST', '/api/reviews', { session_id: 'S', reviews: [{ word_id: words[21], rating: 3, reviewed_at: new Date(now).toISOString() }, { word_id: words[0], rating: 1, reviewed_at: new Date(now + 1000).toISOString() }] }],
    ['POST', '/api/reviews', { session_id: 'S', reviews: [{ word_id: words[21], rating: 3, reviewed_at: new Date(now).toISOString() }] }],
    ['POST', '/api/practice', { mode: 'cloze', results: [{ word_id: words[30], correct: false, at: new Date(now).toISOString() }, { word_id: words[22], correct: false, at: new Date(now).toISOString() }, { word_id: words[23], correct: true, at: new Date(now).toISOString() }, { word_id: 'w9999', correct: true, at: new Date(now).toISOString() }] }],
    ['PUT', '/api/settings', { new_per_day: 12, evening_mode: 'any_left', discord_on: false }],
    ['GET', '/api/today'],
    ['POST', `/api/words/${words[5]}/report`, { kind: 'meaning', note: '이상' }],
    ['POST', '/api/requests', { text: 'Ermittlung', url: 'https://x.test/a' }],
    ['POST', '/api/requests', { text: 'Ermittlung' }],
    ['GET', '/api/admin/review-queue'],
    ['POST', '/api/admin/requests/1', { status: 'added', word_id: words[9] }],
    ['POST', '/api/admin/words', { items: [{ id: words[1], gloss_ko: '새 뜻', checked: true, close_reports: true, changes: [{ field: 'gloss_ko', old: '뜻 1', new: '새 뜻', why: '왜', applied: 1 }] }, { id: words[2], gender: null, example_hit: 'Das' }] }],
    ['POST', '/api/admin/words/insert', { items: [{ lemma: 'Neuwort', pos: 'noun', level: 'B2', level_src: 'news', gloss_ko: '새' }, { lemma: lem(0), pos: 'verb', level: 'B1', level_src: 'mine' }] }],
    ['POST', '/api/admin/news', { day: '2026-10-29', items: [{ key: 'freuen|verb', n: 2, url: 'https://x.test/n' }, { key: `${lem(11)}|noun`, n: 1 }] }],
    ['POST', '/api/admin/skips', { items: [{ key: 'Leo|noun', reason: 'x' }, { key: 'Neu|noun', reason: 'y' }] }],
    ['POST', '/api/admin/reseq'],
    ['GET', '/api/changes'],
    ['POST', '/api/changes/3/revert'],
    ['POST', '/api/notifications/1/open'],
    ['PUT', `/api/admin/image/${words[0]}?status=failed`],
    ['GET', '/api/words?sort=learned'],
    ['GET', '/api/stats'],
    ['GET', '/api/admin/review-stats'],
  ];
  for (const [m, p, b] of steps) {
    const a = await call(d1, m, p, b);
    const c = await call(pg, m, p, b);
    assert.ok(c.status < 500, `${m} ${p} pg ${JSON.stringify(c.body).slice(0, 300)}`);
    assert.deepEqual(scrub(c), scrub(a), `${m} ${p}`);
  }
  // 알림(알람 경로): 같은 칸 두 번째는 UNIQUE 로 건너뜀 — Postgres 오류 글도 /UNIQUE/i 에 걸려야 한다
  for (const run of [runMorning, runMorning, runEvening]) {
    const a = await run(env(d1));
    const c = await run(env(pg));
    assert.deepEqual(Object.keys(c).sort(), Object.keys(a).sort());
    if ('skipped' in a) assert.equal(c.skipped, a.skipped);
  }
  assert.deepEqual(await dump(pg), await dump(d1));
});

test('d1-to-pg: 덤프 → PGlite 행 수 · 시퀀스(지운 번호 다시 안 씀) · 두 번 돌려도 같음', async () => {
  const { db: _db, pg } = await pgDb();
  const dump = [
    'PRAGMA defer_foreign_keys=TRUE;',
    `INSERT INTO "words" ("id","lemma","pos","level","level_src","seq","created_at") VALUES('w0001','Haus','noun','B1','goethe',7999999999,'2026-10-13 09:01:09');`,
    `INSERT INTO "cards" ("word_id","state","due","stability") VALUES('w0001',2,'2026-10-30T00:00:00.000Z',3.25);`,
    `INSERT INTO "reviews" ("id","word_id","rating","reviewed_at","prev_json") VALUES(5,'w0001',3,'2026-10-29T00:00:00.000Z','{"a":"it''s; ok"}');`,
    `INSERT INTO "sqlite_sequence" ("name","seq") VALUES('reviews',9);`,
    `INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_init.sql','2026-10-13 09:01:09');`,
  ].join('\n');
  assert.equal(parseDump(dump).tables.reviews[0].prev_json, '{"a":"it\'s; ok"}');
  const q = { query: async (text, params) => (await pg.query(text, params, { parsers: PARSERS })).rows };
  const silent = () => {};
  for (let k = 0; k < 2; k++) {
    const rep = await migrate(dump, q, silent);
    // settings 는 스키마가 0001 기본값 6줄을 먼저 넣는다
    for (const r of rep) assert.equal(r.after, r.table === 'settings' ? 6 : r.dump, r.table);
  }
  const { rows } = await pg.query("INSERT INTO reviews(word_id, rating, reviewed_at) VALUES ('w0001', 1, 'x') RETURNING id", [], { parsers: PARSERS });
  assert.equal(rows[0].id, 10);
  const { rows: w } = await pg.query('SELECT seq FROM words', [], { parsers: PARSERS });
  assert.equal(w[0].seq, 7999999999);
});
