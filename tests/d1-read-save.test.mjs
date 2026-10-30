// D1 읽기 줄이기 2차: 단어 목록 두 토막 · 오늘 새 단어 질의 계획 · 로컬 사본 · remote-sql 관문 시험(원격은 부르지 않는다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fakeD1, addWord, lem } from './d1.mjs';
import { newestBackup, openLocalDb } from '../scripts/db/local-copy.mjs';
import { estimateRows, judge, parseArgs } from '../scripts/db/remote-sql.mjs';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(s, e) { this.ctx = s; this.env = e; } }', shortCircuit: true };
  return next(spec, ctx);
}`));
crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));
const { default: worker } = await import('../worker/index.ts');
const env = (db) => ({ DB: db, IMG: { get: async () => null }, API_TOKEN: 't', SCHED: { idFromName: () => 'x', get: () => ({ ensure: async () => ({}) }) } });
const get = async (db, path) => {
  const res = await worker.fetch(new Request('https://x.test' + path, { headers: { authorization: 'Bearer t' } }), env(db), { waitUntil() {} });
  return res.json();
};

/** seq 0..n-1. 배운 카드: 끝 3장(state 2) + introduced_at 만 있는 1장(state 0, w0005) */
function seed(n) {
  const db = fakeD1();
  for (let i = 0; i < n; i++) addWord(db, { id: `w${String(i).padStart(4, '0')}`, lemma: lem(i), seq: i, level: i % 2 ? 'B2' : 'B1' });
  for (const i of [n - 1, n - 2, n - 3]) db.raw.prepare("UPDATE cards SET state = 2, introduced_at = '2026-10-20T00:00:00Z' WHERE word_id = ?").run(`w${String(i).padStart(4, '0')}`);
  db.raw.prepare("UPDATE cards SET introduced_at = '2026-10-21T00:00:00Z' WHERE word_id = 'w0005'").run();
  return db;
}
const OLD = 'SELECT w.id FROM words w JOIN cards c ON c.word_id = w.id ORDER BY (c.state = 0 AND c.introduced_at IS NULL), w.seq, w.lemma';

test('/api/words 학습 순서: 두 토막 결과가 옛 한 질의와 쪽마다 같다', async () => {
  const db = seed(23);
  const want = db.raw.prepare(OLD).all().map((r) => r.id);
  for (const size of [1, 3, 4, 5, 7, 50]) {
    const got = [];
    for (let page = 1; page <= Math.ceil(23 / size) + 1; page++) {
      const r = await get(db, `/api/words?size=${size}&page=${page}`);
      got.push(...r.items.map((it) => it.word.id));
      if (r.items.length < size) assert.equal(r.total, got.length, `size ${size} 마지막 쪽 총수`);
    }
    assert.deepEqual(got, want, `size ${size}`);
  }
});

test('/api/words: 거르기(state·level)도 옛 결과와 같다', async () => {
  const db = seed(23);
  const q = (where) =>
    db.raw
      .prepare(`SELECT w.id FROM words w JOIN cards c ON c.word_id = w.id WHERE ${where} ORDER BY (c.state = 0 AND c.introduced_at IS NULL), w.seq, w.lemma`)
      .all()
      .map((r) => r.id);
  const ids = async (qs) => (await get(db, `/api/words?size=50&${qs}`)).items.map((it) => it.word.id);
  assert.deepEqual(await ids('state=review'), q('c.state = 2'));
  assert.deepEqual(await ids('state=new'), q('c.state = 0'));
  assert.deepEqual(await ids('level=B2'), q("w.level = 'B2'"));
  assert.deepEqual(await ids('state=learning'), []);
});

test('질의 계획: 목록 앞 토막은 cards 색인, 뒤 토막은 words_seq, 오늘 새 단어는 json_each 부터', () => {
  const db = fakeD1();
  const plan = (sql) => db.raw.prepare('EXPLAIN QUERY PLAN ' + sql).all().map((r) => r.detail).join(' | ');
  const learned = plan(`SELECT w.id FROM (SELECT word_id FROM cards WHERE state IN (1, 2, 3) UNION SELECT word_id FROM cards INDEXED BY cards_introduced WHERE introduced_at IS NOT NULL) l
    CROSS JOIN cards c ON c.word_id = l.word_id CROSS JOIN words w ON w.id = l.word_id ORDER BY w.seq, w.lemma LIMIT 50`);
  assert.match(learned, /cards_state/);
  assert.match(learned, /cards_introduced/);
  assert.match(
    plan('SELECT w.id FROM words w CROSS JOIN cards c ON c.word_id = w.id WHERE c.state = 0 AND c.introduced_at IS NULL ORDER BY w.seq, w.lemma LIMIT 50'),
    /SCAN w USING INDEX words_seq/,
  );
  assert.match(plan("SELECT w.id FROM json_each('[]') j CROSS JOIN words w ON w.id = j.value CROSS JOIN cards c ON c.word_id = w.id WHERE c.state = 0"), /^SCAN j/);
});

// ---- 로컬 사본 · remote-sql ----
const DUMP = `PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE words (id TEXT PRIMARY KEY, level TEXT);
INSERT INTO words VALUES ('a','B1');
CREATE TABLE reviews (id INTEGER PRIMARY KEY, word_id TEXT REFERENCES words(id));
INSERT INTO reviews VALUES (1,'a');
`;

test('local-copy: 이름이 맞는 가장 새 백업만 고르고(gz 포함) 사본으로 푼다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worty-bk-'));
  try {
    writeFileSync(join(dir, '2026-10-20.sql.gz'), gzipSync(DUMP));
    writeFileSync(join(dir, 'level_delete_261030.sql'), 'DELETE FROM words;'); // 일부 SQL: 고르면 안 된다
    assert.equal(newestBackup(dir), join(dir, '2026-10-20.sql.gz'));
    const db = openLocalDb({ backup: newestBackup(dir), out: join(dir, 'c.sqlite') });
    assert.equal(db.prepare('SELECT count(*) n FROM words').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM reviews').get().n, 1);
    db.close();
    assert.equal(newestBackup(join(dir, 'none')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('remote-sql: 작은 SQL 은 통과, 임시 표 상관 부질의는 한도 초과로 거절, --force 면 통과; 사본은 안 바뀐다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worty-rs-'));
  try {
    const copy = join(dir, 'c.sqlite');
    const db = new DatabaseSync(copy);
    db.exec('CREATE TABLE words (id TEXT PRIMARY KEY, level TEXT)');
    db.exec('BEGIN');
    const ins = db.prepare('INSERT INTO words VALUES (?, ?)');
    for (let i = 0; i < 3000; i++) ins.run(`w${i}`, 'C1');
    db.exec('COMMIT');
    db.close();

    const small = estimateRows("UPDATE words SET level='B1' WHERE id='w1'", { copy });
    const bad = estimateRows(
      `CREATE TABLE _fix(id TEXT, nl TEXT); INSERT INTO _fix SELECT id, 'B2' FROM words;
       UPDATE words SET level=(SELECT nl FROM _fix WHERE _fix.id=words.id) WHERE level='C1' AND EXISTS(SELECT 1 FROM _fix WHERE _fix.id=words.id);`,
      { copy },
    );
    assert.ok(small < 100, `작은 SQL ${small}`);
    assert.ok(bad > 1_000_000, `상관 부질의 ${bad}`); // 3000 × 3000 훑기
    assert.equal(judge(small).allowed, true);
    assert.equal(judge(bad).allowed, false);
    assert.equal(judge(bad, { force: true }).allowed, true);
    assert.equal(judge(bad, { limit: 1e9 }).allowed, true);

    const after = new DatabaseSync(copy);
    assert.equal(after.prepare("SELECT count(*) n FROM words WHERE level='C1'").get().n, 3000, '사본은 그대로');
    assert.equal(after.prepare("SELECT count(*) n FROM sqlite_master WHERE name='_fix'").get().n, 0);
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('remote-sql 인자: 파일 또는 --command 하나, --force · --limit · --dry', () => {
  assert.deepEqual(parseArgs(['a.sql', '--force', '--limit', '5']), { force: true, dry: false, limit: 5, file: 'a.sql', command: null });
  assert.equal(parseArgs(['--command', 'SELECT 1', '--dry']).command, 'SELECT 1');
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(['a.sql', '--command', 'x']));
  assert.throws(() => parseArgs(['a.sql', '--limit', '0']));
});
