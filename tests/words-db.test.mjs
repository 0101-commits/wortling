// 카드 검토·뉴스 단어 DB 함수 시험: 0004 마이그레이션 + D1 흉내(tests/d1.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1, addWord } from './d1.mjs';
import { buildToday, loadSettings } from '../worker/deck.ts';

test('0004: words 새 칸 4 · 새 표 5', () => {
  const db = fakeD1();
  const cols = db.raw.prepare("SELECT name FROM pragma_table_info('words')").all().map((r) => r.name);
  for (const c of ['checked_at', 'news_rank', 'news_hits30', 'pinned']) assert.ok(cols.includes(c), c);
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['word_changes', 'word_reports', 'word_requests', 'news_days', 'word_skips']) assert.ok(tables.includes(t), t);
});

test('pinned: 레벨 설정(B1) 밖의 C1 단어도 새 카드 맨 앞', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', seq: 1 });
  addWord(db, { id: 'w0002', lemma: 'Ermittlung', level: 'C1', seq: 2, pinned: 1 });
  addWord(db, { id: 'w0003', lemma: 'Kuchen', level: 'C1', seq: 3 });
  const s = await loadSettings(db);
  assert.equal(s.level, 'B1');
  const t = await buildToday(db, s, new Date('2026-10-15T00:00:00Z'));
  assert.deepEqual(t.fresh.map((x) => x.word.id), ['w0002', 'w0001']);
});
import { getNews, insertWords, patchWords, putNews, putSkips, reseq, reviewQueue, wordKeys } from '../worker/words.ts';

const NOW = new Date('2026-10-15T00:00:00Z');
const row = (db, sql) => ({ ...db.raw.prepare(sql).get() });

test('patchWords: 고침 + 기록 + checked_at + 신고 닫기 + 그림 다시', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Umzug', gloss_ko: '이동', image_status: 'ok' });
  db.raw.prepare("INSERT INTO word_reports(word_id, kind, created_at) VALUES ('w0001', 'meaning', '2026-10-14T00:00:00Z')").run();
  const r = await patchWords(db, [{
    id: 'w0001', gloss_ko: '이사', gloss_status: 'checked', checked: true, image_reset: true, close_reports: true,
    changes: [{ field: 'gloss_ko', old: '이동', new: '이사', why: '주된 뜻', applied: 1, source: 'report' }],
  }], NOW);
  assert.deepEqual(r, { updated: 1, changes: 1 });
  assert.deepEqual(row(db, "SELECT gloss_ko, gloss_status, checked_at, image_status FROM words WHERE id = 'w0001'"),
    { gloss_ko: '이사', gloss_status: 'checked', checked_at: '2026-10-15T00:00:00.000Z', image_status: 'none' });
  assert.equal(row(db, 'SELECT closed_at FROM word_reports').closed_at, '2026-10-15T00:00:00.000Z');
  assert.deepEqual(row(db, 'SELECT field, old, new, why, source, applied FROM word_changes'),
    { field: 'gloss_ko', old: '이동', new: '이사', why: '주된 뜻', source: 'report', applied: 1 });
});

test('patchWords: 예전 규칙(gloss_ko 만 → generated) · 잘못된 값 400', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', gloss_status: 'checked' });
  await patchWords(db, [{ id: 'w0001', gloss_ko: '집' }]);
  assert.equal(row(db, 'SELECT gloss_status FROM words').gloss_status, 'generated');
  await patchWords(db, [{ id: 'w0001', news_rank: 12, gender: 'das', plural: 'Häuser', level: 'B2' }]);
  assert.deepEqual(row(db, 'SELECT news_rank, gender, plural, level FROM words'), { news_rank: 12, gender: 'das', plural: 'Häuser', level: 'B2' });
  await assert.rejects(patchWords(db, [{ id: 'w0001', level: 'A1' }]), /bad level/);
  await assert.rejects(patchWords(db, [{ id: 'w0001', gender: 'm' }]), /bad gender/);
  await assert.rejects(patchWords(db, [{ id: 'w0001', news_rank: 0 }]), /bad news_rank/);
  await assert.rejects(patchWords(db, [{ id: 'w0001', changes: [{ field: 'lemma', old: 'a', new: 'b', applied: 1 }] }]), /bad change/);
});

test('reviewQueue: 신고 → 14일 안 새 카드 → 3일 안 복습 → 안 본 것 → 180일 지난 것', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Awort', seq: 1 });
  addWord(db, { id: 'w0002', lemma: 'Bwort', seq: 2, checked_at: '2026-10-14T00:00:00.000Z' });
  addWord(db, { id: 'w0003', lemma: 'Cwort', seq: 3 });
  addWord(db, { id: 'w0004', lemma: 'Dwort', seq: 4, state: 2, due: '2026-10-17T00:00:00.000Z', introduced_at: '2026-10-01T00:00:00.000Z' });
  addWord(db, { id: 'w0005', lemma: 'Ewort', seq: 5, state: 2, due: '2026-10-25T00:00:00.000Z', introduced_at: '2026-10-01T00:00:00.000Z' });
  addWord(db, { id: 'w0006', lemma: 'Fwort', seq: 6, level: 'C1' });
  addWord(db, { id: 'w0007', lemma: 'Gwort', seq: 7, level: 'C1', checked_at: '2026-03-01T00:00:00.000Z' });
  addWord(db, { id: 'w0008', lemma: 'Hwort', seq: 8, level: 'C1', checked_at: '2026-10-10T00:00:00.000Z' });
  db.raw.prepare("INSERT INTO word_reports(word_id, kind, note, created_at) VALUES ('w0006', 'example', '예문이 이상', '2026-10-14T00:00:00Z')").run();
  db.raw.prepare("INSERT INTO word_changes(word_id, field, old, new, applied, reverted_at, at) VALUES ('w0003', 'gloss_ko', 'a', 'b', 1, '2026-10-14T00:00:00Z', '2026-10-13T00:00:00Z')").run();
  const q = await reviewQueue(db, 50, NOW);
  assert.deepEqual(q.map((w) => w.id), ['w0006', 'w0001', 'w0003', 'w0004', 'w0005', 'w0007']);
  assert.deepEqual(q[0].report, { kind: 'example', note: '예문이 이상' });
  assert.deepEqual(q.find((w) => w.id === 'w0003').reverted, ['gloss_ko']);
  assert.deepEqual(q.find((w) => w.id === 'w0001').reverted, []);
  assert.equal((await reviewQueue(db, 2, NOW)).length, 2);
});

test('reseq: 배운 카드는 그대로, 넣은 단어 → B1 → B2, 같은 레벨은 최근 30일 뉴스 2회 이상 → news_rank → freq_rank', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Gelernt', seq: 1, state: 2, introduced_at: '2026-10-01T00:00:00.000Z' });
  addWord(db, { id: 'w0002', lemma: 'Alt', seq: 2, freq_rank: 10 });
  addWord(db, { id: 'w0003', lemma: 'Ermittlung', seq: 3, news_rank: 500 });
  addWord(db, { id: 'w0004', lemma: 'Vorfall', seq: 4, news_rank: 9000 });
  addWord(db, { id: 'w0005', lemma: 'Zweit', seq: 5, level: 'B2', news_rank: 1 });
  addWord(db, { id: 'w0006', lemma: 'Mein', seq: 6, level: 'C1', pinned: 1 });
  db.raw.prepare("INSERT INTO news_days(day, key, n) VALUES ('2026-10-14', 'Vorfall|noun', 2), ('2026-10-01', 'Vorfall|noun', 1), ('2026-09-01', 'Ermittlung|noun', 9)").run();
  const r = await reseq(db, NOW);
  assert.deepEqual(db.raw.prepare('SELECT id FROM words ORDER BY seq').all().map((x) => x.id), ['w0001', 'w0006', 'w0004', 'w0003', 'w0002', 'w0005']);
  assert.equal(row(db, "SELECT seq FROM words WHERE id = 'w0001'").seq, 1, '배운 카드 seq 그대로');
  assert.equal(row(db, "SELECT news_hits30 FROM words WHERE id = 'w0004'").news_hits30, 3);
  assert.equal(row(db, "SELECT news_hits30 FROM words WHERE id = 'w0003'").news_hits30, 0, '30일 넘은 기록은 안 셈');
  assert.ok(r.moved > 0);
  assert.equal((await reseq(db, NOW)).moved, 0, '두 번째는 바꿀 것 없음');
});

test('putNews: 같은 날·열쇠는 덮어씀 · 60일 지난 줄 지움 · getNews 는 기간 합 + 마지막 링크', async () => {
  const db = fakeD1();
  await putNews(db, '2026-08-01', [{ key: 'Alt|noun', n: 1, url: null }]);
  await putNews(db, '2026-10-14', [{ key: 'Vorfall|noun', n: 2, url: 'https://www.tagesschau.de/a' }]);
  await putNews(db, '2026-10-15', [{ key: 'Vorfall|noun', n: 1, url: 'https://www.ndr.de/b' }]);
  await putNews(db, '2026-10-15', [{ key: 'Vorfall|noun', n: 4, url: 'https://www.ndr.de/c' }]);
  assert.equal(row(db, "SELECT count(*) AS n FROM news_days WHERE day = '2026-08-01'").n, 0);
  assert.deepEqual(await getNews(db, '2026-10-01'), [{ key: 'Vorfall|noun', n: 6, url: 'https://www.ndr.de/c' }]);
  await assert.rejects(putNews(db, '2026-10-15', [{ key: 'x', n: 1 }]), /bad item/);
  await assert.rejects(putNews(db, '2026-10-15', [{ key: 'A|noun', n: 1, url: 'http://x' }]), /bad item/);
  await assert.rejects(putNews(db, '15.10.', []), /bad day/);
});

test('insertWords: news_rank·pinned·level_src(news|mine) · 이미 있는 (lemma,pos) 건너뜀 · 모르는 level_src 400', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', seq: 1 });
  const r = await insertWords(db, [
    { lemma: 'Ermittlung', pos: 'noun', level: 'B1', level_src: 'news', news_rank: 812, gloss_ko: '수사' },
    { lemma: 'Haus', pos: 'noun', level: 'B1', level_src: 'mine' },
    { lemma: 'beschatten', pos: 'verb', level: 'C1', level_src: 'mine', pinned: 1 },
  ]);
  assert.deepEqual(r, { inserted: 2, first_id: 'w0002', last_id: 'w0003' });
  assert.deepEqual(db.raw.prepare('SELECT id, level_src, news_rank, pinned, seq, gloss_status FROM words WHERE id > ? ORDER BY id').all('w0001').map((x) => ({ ...x })), [
    { id: 'w0002', level_src: 'news', news_rank: 812, pinned: 0, seq: 2, gloss_status: 'generated' },
    { id: 'w0003', level_src: 'mine', news_rank: null, pinned: 1, seq: 3, gloss_status: 'missing' },
  ]);
  assert.equal(row(db, "SELECT state FROM cards WHERE word_id = 'w0003'").state, 0);
  await assert.rejects(insertWords(db, [{ lemma: 'X', pos: 'noun', level: 'B1', level_src: 'kbs' }]), /bad level_src/);
});

test('wordKeys · putSkips', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', news_rank: 3 });
  await putSkips(db, [{ key: 'Bingo|noun', reason: '영화 말' }, { key: 'Bingo|noun', reason: '또' }], NOW);
  assert.deepEqual(await wordKeys(db), { items: [{ id: 'w0001', lemma: 'Haus', pos: 'noun', news_rank: 3 }], skips: ['Bingo|noun'] });
  await assert.rejects(putSkips(db, [{ key: 'nopipe' }], NOW), /bad item/);
});
import { addReport, addRequest, listChanges, listRequests, revertChange, reviewStats, settleRequest } from '../worker/words.ts';

test('addReport: 종류 검사 · 없는 단어 404 · 메모 200자로 자름', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus' });
  const r = await addReport(db, 'w0001', { kind: 'example', note: 'x'.repeat(300) }, NOW);
  assert.equal(r.ok, true);
  assert.equal(row(db, 'SELECT length(note) AS n FROM word_reports').n, 200);
  await assert.rejects(addReport(db, 'w0001', { kind: 'spam' }, NOW), /bad kind/);
  await assert.rejects(addReport(db, 'w9999', { kind: 'meaning' }, NOW), (e) => e.status === 404);
});

test('addRequest: 글자 단어만 · 주소·이모지·61자·빈 값 400 · 같은 대기 글은 같은 번호', async () => {
  const db = fakeD1();
  const a = await addRequest(db, { text: '  Ermittlung ', url: 'https://www.dw.com/de/x' }, NOW);
  assert.deepEqual(a, { ok: true, id: 1, duplicate: false });
  assert.deepEqual(await addRequest(db, { text: 'Ermittlung' }, NOW), { ok: true, id: 1, duplicate: true });
  assert.equal((await addRequest(db, { text: 'die Daumen drücken' }, NOW)).id, 2);
  for (const text of ['', 'https://www.dw.com/de/x', 'Ermittlung🙂', 'a'.repeat(61), '123', 42])
    await assert.rejects(addRequest(db, { text }, NOW), /bad_text/, String(text));
  await assert.rejects(addRequest(db, { text: 'Haus', url: 'http://x' }, NOW), /bad_url/);
  await assert.rejects(addRequest(db, { text: 'Haus', url: 'https://' + 'x'.repeat(600) }, NOW), /bad_url/);
});

test('settleRequest: exists 면 그 단어 pinned · 두 번째는 409 · listRequests 모양', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Ermittlung' });
  await addRequest(db, { text: 'ermittlung' }, NOW);
  await addRequest(db, { text: 'Quatschwort' }, NOW);
  assert.deepEqual((await listRequests(db, 'queued', 50)).map((r) => r.text), ['ermittlung', 'Quatschwort']);
  await settleRequest(db, 1, { status: 'exists', word_id: 'w0001' });
  await settleRequest(db, 2, { status: 'rejected', note: '독일어 아님' });
  assert.equal(row(db, "SELECT pinned FROM words WHERE id = 'w0001'").pinned, 1);
  await assert.rejects(settleRequest(db, 1, { status: 'added', word_id: 'w0001' }), (e) => e.status === 409);
  await assert.rejects(settleRequest(db, 2, { status: 'queued' }), /bad status/);
  await assert.rejects(settleRequest(db, 2, { status: 'added' }), /word_id required/);
  const list = await listRequests(db, undefined, 10);
  assert.deepEqual(list[0], { id: 2, text: 'Quatschwort', url: null, created_at: '2026-10-15T00:00:00.000Z', status: 'rejected', word_id: null, lemma: null, note: '독일어 아님', learned: false });
  assert.equal(list[1].lemma, 'Ermittlung');
});

test('revertChange: 원래 값으로 · 그 뒤 바뀌었으면 409 · 두 번 409 · 확인 필요는 409', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Umzug', gloss_ko: '이사' });
  await patchWords(db, [{ id: 'w0001', gloss_ko: '이사', changes: [
    { field: 'gloss_ko', old: '이동', new: '이사', why: '주된 뜻', applied: 1 },
    { field: 'level', old: 'B1', new: 'B2', why: 'DAFlex 다름', applied: 0 },
  ] }], NOW);
  const [flag, fix] = await listChanges(db, 10);
  assert.equal(fix.field, 'gloss_ko');
  assert.equal(fix.lemma, 'Umzug');
  await assert.rejects(revertChange(db, flag.id, NOW), (e) => e.status === 409);
  await revertChange(db, fix.id, NOW);
  assert.equal(row(db, 'SELECT gloss_ko FROM words').gloss_ko, '이동');
  await assert.rejects(revertChange(db, fix.id, NOW), (e) => e.status === 409);
  // 다시 고쳐진 뒤 다른 값으로 또 바뀐 경우
  await patchWords(db, [{ id: 'w0001', gloss_ko: '이사', changes: [{ field: 'gloss_ko', old: '이동', new: '이사', applied: 1 }] }], NOW);
  await patchWords(db, [{ id: 'w0001', gloss_ko: '이전' }], NOW);
  const again = (await listChanges(db, 10))[0];
  await assert.rejects(revertChange(db, again.id, NOW), (e) => e.status === 409 && /changed_since/.test(e.message));
  await assert.rejects(revertChange(db, 999, NOW), (e) => e.status === 404);
});

test('reviewStats: 검토 수 · 이번 주 고침·확인 필요·새 단어', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', checked_at: '2026-10-14T00:00:00.000Z' });
  await insertWords(db, [{ lemma: 'Vorfall', pos: 'noun', level: 'B1', level_src: 'news' }]);
  await patchWords(db, [{ id: 'w0001', changes: [{ field: 'level', old: 'B1', new: 'B2', applied: 0 }] }], new Date());
  await addRequest(db, { text: 'Ermittlung' }, new Date());
  const s = await reviewStats(db, new Date());
  assert.deepEqual(s, { total: 2, checked: 1, week: { applied: 0, flagged: 1, news: 1, mine: 0, requests: 1 } });
});

// ---------- 최종 검토 반영 ----------
import { decide } from '../scripts/words/lib.mjs';

test('검토 → 고치기: 복수 「없음」(null) 판정도 400 없이 적용(검토 Critical 1)', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Personal', plural: 'Personale' });
  const w = (await reviewQueue(db, 1, NOW))[0];
  const d = decide(w, { genders: ['das'], plural: null, daflex: null, hasForm: () => true }, { ok: false, fix: { plural: null }, why: '복수 없음' });
  assert.deepEqual(d.patch, { plural: null });
  await patchWords(db, [{ id: w.id, ...d.patch, checked: true, changes: d.changes }], NOW);
  assert.equal(row(db, 'SELECT plural FROM words').plural, null);
});

test('revertChange: 예문·번역을 같이 고친 것은 같이 되돌린다(검토 Important 2)', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Umzug', example_de: 'Der Umzug dauerte lange.', example_ko: '이사는 오래 걸렸어요.' });
  await patchWords(db, [{ id: 'w0001', example_de: 'Der Umzug dauerte lange.', example_ko: '이사는 오래 걸렸어요.', changes: [
    { field: 'example_de', old: 'Der Umzug war laut.', new: 'Der Umzug dauerte lange.', applied: 1 },
    { field: 'example_ko', old: '이사는 시끄러웠어요.', new: '이사는 오래 걸렸어요.', applied: 1 },
  ] }], NOW);
  const de = (await listChanges(db, 10)).find((c) => c.field === 'example_de');
  await revertChange(db, de.id, NOW);
  assert.deepEqual(row(db, 'SELECT example_de, example_ko FROM words'), { example_de: 'Der Umzug war laut.', example_ko: '이사는 시끄러웠어요.' });
  assert.equal(row(db, 'SELECT count(*) AS n FROM word_changes WHERE reverted_at IS NOT NULL').n, 2);
});

test('listChanges: before 로 더 보기(검토 Important 3)', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus' });
  await patchWords(db, [{ id: 'w0001', changes: [1, 2, 3].map((i) => ({ field: 'note', old: null, new: null, why: String(i), applied: 0 })) }], NOW);
  assert.deepEqual((await listChanges(db, 2)).map((c) => c.id), [3, 2]);
  assert.deepEqual((await listChanges(db, 2, 2)).map((c) => c.id), [1]);
});

test('reviewQueue: level_src 를 같이 준다(검토 Important 4)', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', level_src: 'goethe' });
  assert.equal((await reviewQueue(db, 1, NOW))[0].level_src, 'goethe');
});
