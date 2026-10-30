// D1 읽기 지킴이(worker/budget.ts) · 색인(0010) · 단어 목록 총수 · words-export 시험
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1, addWord, lem } from './d1.mjs';
import { meterDb, recordReads, todayTotal, overBudget, utcDay, ALERT_AT, BLOCK_AT } from '../worker/budget.ts';
import { memo, clearMemo } from '../worker/memo.ts';
import { register } from 'node:module';

// worker/index.ts → alarm.ts 가 cloudflare:workers 를 읽는다 → 시험에선 빈 DurableObject 로 대신한다
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(s, e) { this.ctx = s; this.env = e; } }', shortCircuit: true };
  return next(spec, ctx);
}`));

// crypto.subtle.timingSafeEqual 은 workerd 전용 → Node 에선 같은 뜻으로 채운다
crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));

const env = (db, extra = {}) => ({ DB: db, IMG: { get: async () => null }, API_TOKEN: 't', SCHED: { idFromName: () => 'x', get: () => ({ ensure: async () => ({}) }) }, ...extra });
const NOW = new Date('2026-10-31T05:00:00Z');

test('meterDb: all · first · run · batch 의 rows_read 를 더한다', async () => {
  const db = fakeD1();
  for (let i = 0; i < 3; i++) addWord(db, { id: `w000${i}`, lemma: lem(i), seq: i });
  const acc = { rows: 0 };
  const m = meterDb(db, acc);
  await m.prepare('SELECT * FROM words').all();
  assert.equal(acc.rows, 3);
  const one = await m.prepare('SELECT id FROM words WHERE id = ?').bind('w0001').first('id');
  assert.equal(one, 'w0001');
  assert.equal(acc.rows, 4);
  assert.equal(await m.prepare('SELECT id FROM words WHERE id = ?').bind('nope').first(), null);
  await m.batch([m.prepare('SELECT * FROM words'), m.prepare('SELECT * FROM cards')]);
  assert.equal(acc.rows, 4 + 6);
});

test('recordReads: 합계를 더하고, 0 이면 쓰지 않는다', async () => {
  const db = fakeD1();
  const e = env(db);
  await recordReads(e, 0, NOW);
  assert.equal(db.raw.prepare('SELECT count(*) AS c FROM read_budget').get().c, 0);
  await recordReads(e, 100, NOW);
  await recordReads(e, 50, NOW);
  assert.equal(db.raw.prepare('SELECT n FROM read_budget WHERE day = ?').get(utcDay(NOW)).n, 150);
  assert.equal(await todayTotal(e, NOW), 150);
});

test('임계값: ALERT_AT 을 넘는 한 번만 디스코드 알림, BLOCK_AT 부터 막음', async () => {
  const db = fakeD1();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: '1' }), { status: 200 });
  };
  try {
    const e = env(db, { DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/1/abc' });
    await recordReads(e, ALERT_AT - 10, NOW);
    assert.equal(calls.length, 0);
    await recordReads(e, 20, NOW); // 선을 넘는다
    assert.equal(calls.length, 1);
    assert.match(JSON.stringify(calls[0].body), /D1 읽기 오늘 50% 넘음/);
    await recordReads(e, 1000, NOW); // 이미 넘음 → 다시 안 보냄
    assert.equal(calls.length, 1);
    assert.equal(await overBudget(e, NOW), false);
    await recordReads(e, BLOCK_AT, NOW);
    assert.equal(await overBudget(e, NOW), true);
    // 다음 UTC 날은 0 에서 다시
    assert.equal(await overBudget(e, new Date('2026-11-01T00:00:01Z')), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('표가 없으면(0010 미적용) 지킴이를 끄고 오류 없이 지나간다', async () => {
  const db = fakeD1();
  db.raw.exec('DROP TABLE read_budget');
  const e = env(db);
  await recordReads(e, 5_000_000, NOW); // 던지지 않는다
  assert.equal(await todayTotal(e, NOW), null);
  assert.equal(await overBudget(e, NOW), false);
});

test('memo: TTL 안에선 한 번만 계산, clearMemo 로 비움', async () => {
  const db = {};
  let n = 0;
  const f = async () => ++n;
  assert.equal(await memo(db, 'k', 1000, f), 1);
  assert.equal(await memo(db, 'k', 1000, f), 1);
  clearMemo(db);
  assert.equal(await memo(db, 'k', 1000, f), 2);
});

// ---- 요청 단위(worker/index.ts) ----
const { default: worker } = await import('../worker/index.ts');
const call = async (db, path, extra = {}, init = {}) => {
  const waits = [];
  const res = await worker.fetch(new Request('https://x.test' + path, { headers: { authorization: 'Bearer t' }, ...init }), env(db, extra), { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
};
const seed = (db, n) => {
  for (let i = 0; i < n; i++) addWord(db, { id: `w${String(i).padStart(4, '0')}`, lemma: lem(i), seq: i, level: i % 2 ? 'B2' : 'B1', image_status: i % 3 ? 'ok' : 'none' });
};
const used = (db) => db.raw.prepare('SELECT coalesce(sum(n), 0) AS n FROM read_budget').get().n;

test('/api/words: 꽉 차지 않은 쪽은 count 없이 총수, 꽉 찬 쪽은 count 를 기억', async () => {
  const db = fakeD1();
  seed(db, 7);
  let r = await (await call(db, '/api/words?size=50')).json();
  assert.equal(r.total, 7);
  assert.equal(r.items.length, 7);
  const u0 = used(db);
  r = await (await call(db, '/api/words?size=3&page=1')).json();
  assert.equal(r.total, 7);
  const u1 = used(db);
  r = await (await call(db, '/api/words?size=3&page=2')).json();
  assert.equal(r.total, 7);
  const u2 = used(db);
  assert.ok(u2 - u1 < u1 - u0, 'count 를 기억해 둘째 쪽이 더 적게 읽는다');
  r = await (await call(db, '/api/words?size=3&page=3')).json();
  assert.equal(r.total, 7);
  assert.equal(r.items.length, 1);
  r = await (await call(db, '/api/words?size=2&no_total=1')).json();
  assert.equal(r.total, 2);
});

test('/api/stats: 합계·그림 수가 예전과 같다(그림 = 전체 - ok 아닌 것)', async () => {
  const db = fakeD1();
  seed(db, 9); // none = i%3==0 → 0,3,6 → 3개
  const r = await (await call(db, '/api/stats')).json();
  assert.equal(r.total_words, 9);
  assert.equal(r.images, 6);
  assert.equal(r.by_level.B1 + r.by_level.B2, 9);
  assert.equal(r.by_state.new, 9);
});

test('/api/admin/words-export: 한 질의로 전부, 인증 필요', async () => {
  const db = fakeD1();
  seed(db, 5);
  const r = await (await call(db, '/api/admin/words-export')).json();
  assert.equal(r.total, 5);
  assert.deepEqual(Object.keys(r.items[0]).sort(), ['freq_rank', 'gender', 'gloss_ko', 'id', 'image_status', 'introduced_at', 'level', 'level_src', 'lemma', 'pos', 'reps', 'seq', 'state'].sort());
  const noAuth = await worker.fetch(new Request('https://x.test/api/admin/words-export'), env(db), { waitUntil() {} });
  assert.equal(noAuth.status, 401);
});

test('읽기 한도 초과: 관리 길은 429 read_budget, 학습 길(today · word 상세)은 통과', async () => {
  const db = fakeD1();
  seed(db, 3);
  await recordReads(env(db), BLOCK_AT + 1); // 지금 시각 기준 오늘 합계
  let res = await call(db, '/api/admin/words-export');
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'read_budget' });
  res = await call(db, '/api/word/w0001');
  assert.equal(res.status, 200);
  res = await call(db, '/api/today');
  assert.equal(res.status, 200);
});

test('0010 미적용 DB 에서도 요청이 돈다', async () => {
  const db = fakeD1();
  seed(db, 3);
  db.raw.exec('DROP TABLE read_budget');
  const res = await call(db, '/api/admin/words-export');
  assert.equal(res.status, 200);
  assert.equal((await (await call(db, '/api/words')).json()).total, 3);
});

test('0010 색인: 그림·글 거리 질의와 상태·등급 세기가 색인을 탄다(EXPLAIN QUERY PLAN)', () => {
  const db = fakeD1();
  const plan = (sql) => db.raw.prepare('EXPLAIN QUERY PLAN ' + sql).all().map((r) => r.detail).join(' | ');
  assert.match(plan("SELECT count(*) FROM words WHERE image_status != 'ok'"), /words_image_not_ok/);
  assert.match(plan("SELECT w.id FROM words w LEFT JOIN cards c ON c.word_id = w.id WHERE w.image_status = 'none' AND w.scene_en IS NOT NULL ORDER BY coalesce(c.state, 0) != 0 DESC, w.seq LIMIT 13"), /words_image_none/);
  assert.match(plan('SELECT w.id FROM words w LEFT JOIN cards c ON c.word_id = w.id WHERE w.gloss_ko IS NULL OR w.example_de IS NULL OR w.scene_en IS NULL ORDER BY coalesce(c.state, 0) != 0 DESC, w.seq LIMIT 60'), /words_text_gap/);
  assert.match(plan('SELECT state, count(*) FROM cards GROUP BY state'), /cards_state/);
  assert.match(plan('SELECT level, count(*) FROM words GROUP BY level'), /words_level/);
});
