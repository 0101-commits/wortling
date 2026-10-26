// 검사 대기 그림: Worker 처리기(worker/pending.ts) + 대기 처리·판정 갈래(scripts/pending.mjs). AI·Worker 는 가짜
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { putPending, listPending, getPending, deletePending } from '../worker/pending.ts';
import { processPending, sortByVerdict } from '../scripts/pending.mjs';
import { fakeD1, addWord } from './d1.mjs';

// ---------- Worker 처리기 ----------
// KV 흉내: 한 쪽에 2개씩만 줘서 목록의 cursor 이어 읽기도 시험한다
const kv = () => {
  const m = new Map();
  return {
    m,
    async put(k, v, o) {
      m.set(k, { v, meta: o?.metadata });
    },
    async get(k) {
      return m.get(k)?.v ?? null;
    },
    async delete(k) {
      m.delete(k);
    },
    async list({ prefix, cursor }) {
      const names = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const at = cursor ? Number(cursor) : 0;
      const done = at + 2 >= names.length;
      return { keys: names.slice(at, at + 2).map((name) => ({ name, metadata: m.get(name).meta })), list_complete: done, cursor: done ? undefined : String(at + 2) };
    },
  };
};
const webp = (n = 10, type = 'image/webp') => new Request('https://w.example/x', { method: 'PUT', headers: { 'content-type': type }, body: new Uint8Array(n).fill(7) });
const setup = () => {
  const DB = fakeD1();
  addWord(DB, { id: 'w1', lemma: 'Hund' });
  addWord(DB, { id: 'w2', lemma: 'Katze' });
  addWord(DB, { id: 'w3', lemma: 'Maus' });
  return { DB, IMG: kv() };
};
const status = async (p) => p.then((r) => r.status, (e) => e.status);

test('worker 대기 올리기: 열쇠는 pending/ 아래, 크기·형식·없는 단어 검사', async () => {
  const env = setup();
  const r = await putPending({ req: webp(), env, url: new URL('https://w.example'), params: ['w1'] });
  assert.equal(r.status, 200);
  assert.ok(env.IMG.m.has('pending/w1.webp'));
  assert.equal(env.IMG.m.has('w1.webp'), false, '공개 그림 열쇠는 건드리지 않는다');
  assert.equal(env.IMG.m.get('pending/w1.webp').meta.bytes, 10);
  const go = (req, id) => status(putPending({ req, env, url: new URL('https://w.example'), params: [id] }));
  assert.equal(await go(webp(), 'nope'), 404);
  assert.equal(await go(webp(10, 'image/png'), 'w1'), 415);
  assert.equal(await go(webp(0), 'w1'), 400);
  assert.equal(await go(webp(200 * 1024 + 1), 'w1'), 413);
  assert.equal(await go(webp(200 * 1024), 'w1'), 200);
});

test('worker 대기 목록·받기·지우기', async () => {
  const env = setup();
  const ctx = (id) => ({ req: webp(), env, url: new URL('https://w.example'), params: [id] });
  for (const id of ['w3', 'w1', 'w2']) {
    await putPending(ctx(id));
    await new Promise((r) => setTimeout(r, 3));
  }
  env.IMG.m.set('w1.webp', { v: new Uint8Array(1) }); // 공개 그림은 목록에 안 나온다
  const list = await (await listPending(ctx(''))).json();
  assert.deepEqual(list.items.map((x) => x.id), ['w3', 'w1', 'w2'], '올린 순서 · 두 쪽에 걸쳐도 끝까지');
  assert.ok(list.items.every((x) => x.at && x.bytes === 10));
  const got = await getPending(ctx('w1'));
  assert.equal(got.headers.get('content-type'), 'image/webp');
  assert.equal((await got.arrayBuffer()).byteLength, 10);
  assert.equal(await status(getPending(ctx('zz'))), 404);
  assert.equal((await deletePending(ctx('w1'))).status, 200);
  assert.equal((await deletePending(ctx('w1'))).status, 200, '없어도 성공');
  assert.equal(env.IMG.m.has('pending/w1.webp'), false);
  assert.equal(env.IMG.m.has('w1.webp'), true);
});

// ---------- sortByVerdict ----------
test('sortByVerdict: null = 전부 보류 + down · 빠진 것 보류 · 탈락·통과 가름', () => {
  const list = [{ w: { id: 'a' } }, { w: { id: 'b' } }, { id: 'c' }, { id: 'd' }];
  const down = sortByVerdict(list, null);
  assert.equal(down.down, true);
  assert.equal(down.hold.length, 4);
  const v = new Map([['a', { ok: true }], ['b', { ok: false, why: 'x' }], ['c', { ok: true }]]);
  const s = sortByVerdict(list, v);
  assert.equal(s.down, false);
  assert.deepEqual(s.pass.map((d) => d.w?.id ?? d.id), ['a', 'c']);
  assert.deepEqual(s.reject.map((d) => d.w?.id), ['b']);
  assert.deepEqual(s.hold.map((d) => d.id), ['d']);
  assert.equal(sortByVerdict([], new Map()).pass.length, 0);
});

// ---------- processPending ----------
const fakeWorker = (pending, words) => {
  const calls = [];
  const api = async (p, o = {}) => {
    const method = o.method ?? 'GET';
    calls.push(`${method} ${p}`);
    let m;
    if (p === '/api/admin/pending') return { items: [...pending.keys()].map((id) => ({ id })) };
    if ((m = p.match(/^\/api\/word\/(\w+)$/))) {
      if (!words[m[1]]) throw new Error(`GET ${p} → 404 not_found`);
      return { word: words[m[1]] };
    }
    if ((m = p.match(/^\/api\/admin\/pending\/(\w+)$/))) {
      if (method === 'DELETE') return pending.delete(m[1]), { ok: true };
      return pending.get(m[1]);
    }
    if ((m = p.match(/^\/api\/admin\/image\/(\w+)$/))) {
      words[m[1]].image = true;
      words[m[1]].uploaded = o.raw;
      return { ok: true };
    }
    throw new Error(`뜻밖의 호출 ${method} ${p}`);
  };
  return { api, calls };
};
const W = (id, over = {}) => ({ id, lemma: id.toUpperCase(), gender: null, gloss_ko: '뜻', image: false, ...over });
const run = (f, judge, extra = {}) => processPending({ api: f.api, judge, say: () => {}, ...extra });

test('processPending: 통과 → 올리고 대기 삭제 · 탈락(고친 장면) → 삭제 + fix·front · 장면 없는 탈락 → gaveUp', async () => {
  const pending = new Map([['a', Buffer.from('A')], ['b', Buffer.from('B')], ['c', Buffer.from('C')]]);
  const words = { a: W('a'), b: W('b'), c: W('c') };
  const f = fakeWorker(pending, words);
  const saved = [];
  const judged = [];
  const r = await run(
    f,
    async (items) => (judged.push(...items.map((i) => i.id)), new Map([['a', { ok: true }], ['b', { ok: false, why: '다리 5개', scene: 'Borti sits' }], ['c', { ok: false, why: '뜻 안 맞음', scene: null }]])),
    { saveRejected: async (...a) => saved.push(a.slice(0, 3)) },
  );
  assert.deepEqual(r.uploaded, ['a']);
  assert.equal(words.a.uploaded.toString(), 'A', '대기 그림 그대로 올림');
  assert.deepEqual(r.rejected, ['b', 'c']);
  assert.deepEqual([...r.fix], [['b', 'Borti sits']]);
  assert.deepEqual(r.front, ['b']);
  assert.deepEqual(r.gaveUp, ['c']);
  assert.equal(pending.size, 0);
  assert.equal(r.left.size, 0);
  assert.equal(r.judgeDown, false);
  assert.deepEqual(saved, [['b', 'pending-meaning', '다리 5개'], ['c', 'pending-meaning', '뜻 안 맞음']]);
  assert.deepEqual(judged.sort(), ['a', 'b', 'c']);
});

test('processPending: 판정 못 받으면(null) 대기를 그대로 두고 judgeDown', async () => {
  const pending = new Map([['a', Buffer.from('A')], ['b', Buffer.from('B')]]);
  const f = fakeWorker(pending, { a: W('a'), b: W('b') });
  const r = await run(f, async () => null);
  assert.equal(r.judgeDown, true);
  assert.deepEqual([...r.left].sort(), ['a', 'b']);
  assert.equal(pending.size, 2);
  assert.ok(!f.calls.some((c) => c.startsWith('DELETE') || c.includes('/image/')));
});

test('processPending: 묶음 둘째에서 막히면 첫째 결과는 살리고 나머지는 대기에 남김 · 판정에서 빠진 그림도 남김', async () => {
  const pending = new Map(['a', 'b', 'c'].map((id) => [id, Buffer.from(id)]));
  const f = fakeWorker(pending, { a: W('a'), b: W('b'), c: W('c') });
  let n = 0;
  const r = await run(f, async (items) => (++n === 1 ? new Map([['a', { ok: true }]]) : null), { batch: 2 });
  assert.deepEqual(r.uploaded, ['a']);
  assert.deepEqual([...r.left].sort(), ['b', 'c'], 'b 는 판정에서 빠짐, c 는 막힘');
  assert.equal(r.judgeDown, true);
});

test('processPending: 이미 올라간 단어·없는 단어의 대기분은 지움(판정 안 함) · 다시 그리기 단어는 검사', async () => {
  const pending = new Map(['a', 'b', 'c'].map((id) => [id, Buffer.from(id)]));
  const f = fakeWorker(pending, { a: W('a', { image: true }), b: W('b', { image: true }) }); // c 는 단어 없음
  const judged = [];
  const r = await run(f, async (items) => (judged.push(...items.map((i) => i.id)), new Map(items.map((i) => [i.id, { ok: true }]))), { wantsNew: (id) => id === 'b' });
  assert.deepEqual(r.dropped.sort(), ['a', 'c']);
  assert.deepEqual(judged, ['b']);
  assert.deepEqual(r.uploaded, ['b']);
  assert.equal(pending.size, 0);
});

test('processPending: 대기 길이 안 열리면 unavailable · 비어 있으면 판정 안 부름 · dry 는 읽기만', async () => {
  const none = await processPending({ api: async () => { throw new Error('GET /api/admin/pending → 404 not_found'); }, judge: async () => assert.fail('부르면 안 됨'), say: () => {} });
  assert.equal(none.unavailable, true);
  assert.equal(none.left.size, 0);
  const empty = fakeWorker(new Map(), {});
  assert.equal((await run(empty, async () => assert.fail('부르면 안 됨'))).total, 0);
  const pending = new Map([['a', Buffer.from('A')]]);
  const f = fakeWorker(pending, { a: W('a') });
  const d = await run(f, async () => assert.fail('부르면 안 됨'), { dry: true });
  assert.equal(d.total, 1);
  assert.deepEqual(f.calls, ['GET /api/admin/pending']);
  assert.equal(pending.size, 1);
});
