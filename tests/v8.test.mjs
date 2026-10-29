// 기획 v8: 오늘 몫(F1·F3·F5) · 새 단어 더 받기(D3) · 연습 재료·결과(과제 4) — D1 흉내로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1, addWord } from './d1.mjs';
import { EXTRA_MAX, addExtra, buildToday, dropPlan, loadSettings } from '../worker/deck.ts';
import { practiceItems, savePractice } from '../worker/practice.ts';

// 2026-10-26 12:00 KST = 학습일 10-26, 끝 = 10-27 04:00 KST = 10-26 19:00Z
const NOON = new Date('2026-10-26T03:00:00Z');
const DAY_END = '2026-10-26T19:00:00.000Z';
const settings = (db, patch = {}) => loadSettings(db).then((s) => ({ ...s, new_per_day: 2, ...patch }));
const ids = (items) => items.map((i) => i.word.id);

function seed(db) {
  for (let i = 1; i <= 8; i++) addWord(db, { id: `w${i}`, lemma: `Wort${i}`, seq: i });
  // 복습: 아침에 마감 · 오후에 마감(오늘 몫) · 내일 마감(아님)
  addWord(db, { id: 'r1', lemma: 'Morgen', seq: 100, state: 2, due: '2026-10-25T23:00:00.000Z', introduced_at: '2026-10-20T00:00:00.000Z' });
  addWord(db, { id: 'r2', lemma: 'Abend', seq: 101, state: 2, due: '2026-10-26T12:00:00.000Z', introduced_at: '2026-10-20T00:00:00.000Z' });
  addWord(db, { id: 'r3', lemma: 'Morgen2', seq: 102, state: 2, due: '2026-10-26T20:00:00.000Z', introduced_at: '2026-10-20T00:00:00.000Z' });
}

test('F1: 오늘 몫 = 오늘 학습일 끝(04:00) 전에 마감되는 복습 전부 — 낮에 풀릴 카드도 아침부터', async () => {
  const db = fakeD1();
  seed(db);
  const t = await buildToday(db, await settings(db), NOON);
  assert.equal(t.day_end, DAY_END);
  assert.deepEqual(ids(t.due), ['r1', 'r2'], '오후에 마감되는 r2 포함, 다음 학습일 r3 제외');
  assert.deepEqual(ids(t.fresh), ['w1', 'w2']);
  assert.deepEqual(t.plan, { total: 4, done: 0, fresh_total: 2, extra: 0, extra_max: EXTRA_MAX });
  // 같은 날 아침 7:30(알림)에 만든 몫과 같다
  const morning = await buildToday(db, await settings(db), new Date('2026-10-25T22:30:00Z'));
  assert.equal(morning.date, '2026-10-26');
  assert.equal(morning.due.length + morning.fresh.length, 4, '알림 장 수 = 앱 장 수');
});

test('F5: 그날 새 단어 목록은 학습 순서가 바뀌어도 그대로', async () => {
  const db = fakeD1();
  seed(db);
  await buildToday(db, await settings(db), NOON);
  db.raw.prepare("UPDATE words SET seq = 0 WHERE id = 'w5'").run(); // 단어 작업이 순서를 다시 매김
  db.raw.prepare("UPDATE words SET pinned = 1 WHERE id = 'w6'").run(); // 내가 넣은 단어
  const t = await buildToday(db, await settings(db), NOON);
  assert.deepEqual(ids(t.fresh), ['w1', 'w2']);
  // 다음 학습일엔 새 순서
  const next = await buildToday(db, await settings(db), new Date('2026-10-27T03:00:00Z'));
  assert.deepEqual(ids(next.fresh), ['w6', 'w5']);
});

test('오늘 몫 셈: 채점해서 오늘 다시 안 나오면 끝낸 카드, 10분 뒤 다시면 남은 카드', async () => {
  const db = fakeD1();
  seed(db);
  const s = await settings(db);
  await buildToday(db, s, NOON);
  const grade = (id, rating, state, due) => {
    db.raw.prepare("INSERT INTO reviews(word_id, rating, reviewed_at, session_id) VALUES (?, ?, '2026-10-26T03:01:00.000Z', 's')").run(id, rating);
    db.raw.prepare("UPDATE cards SET state = ?, due = ?, introduced_at = coalesce(introduced_at, '2026-10-26T03:01:00.000Z') WHERE word_id = ?").run(state, due, id);
  };
  grade('w1', 3, 2, '2026-10-28T03:00:00.000Z'); // 끝
  grade('w2', 3, 1, '2026-10-26T03:11:00.000Z'); // 학습 단계: 10분 뒤 → 오늘 몫에 남음
  grade('r1', 1, 3, '2026-10-26T03:11:00.000Z'); // 다시 → 오늘 몫에 남음
  const t = await buildToday(db, s, NOON);
  assert.deepEqual(ids(t.fresh), []);
  assert.deepEqual(ids(t.due).sort(), ['r1', 'r2', 'w2']);
  assert.equal(t.plan.done, 1);
  assert.equal(t.plan.total, 4, '몫 크기는 그대로');
  assert.deepEqual(t.ratings, { good: 2, again: 1 });
});

test('오늘은 복습만: 새 단어 0, 끄면 같은 목록이 돌아온다', async () => {
  const db = fakeD1();
  seed(db);
  const t = await buildToday(db, await settings(db, { review_only_day: '2026-10-26' }), NOON);
  assert.deepEqual(ids(t.fresh), []);
  assert.equal(t.plan.fresh_total, 0);
  const back = await buildToday(db, await settings(db), NOON);
  assert.deepEqual(ids(back.fresh), ['w1', 'w2']);
});

test('D3: 새 단어 더 받기 — 5개씩, 하루 20개까지, 오늘 목록 뒤에', async () => {
  const db = fakeD1();
  for (let i = 1; i <= 30; i++) addWord(db, { id: `w${i}`, lemma: `Wort${i}`, seq: i });
  const s = await settings(db);
  await buildToday(db, s, NOON);
  assert.deepEqual(await addExtra(db, s, NOON), { added: 5 });
  const t = await buildToday(db, s, NOON);
  assert.deepEqual(ids(t.fresh), ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
  assert.equal(t.plan.extra, 5);
  for (let k = 0; k < 3; k++) await addExtra(db, s, NOON);
  await assert.rejects(() => addExtra(db, s, NOON), /extra_max/);
  assert.equal((await buildToday(db, s, NOON)).fresh.length, 22);
});

test('설정이 바뀌면 오늘 목록을 다시 정한다(이미 배운 수는 뺌)', async () => {
  const db = fakeD1();
  seed(db);
  await buildToday(db, await settings(db), NOON);
  db.raw.prepare("UPDATE cards SET state = 2, introduced_at = '2026-10-26T03:01:00.000Z', due = '2026-10-29T00:00:00.000Z' WHERE word_id = 'w1'").run();
  await dropPlan(db, NOON).run();
  const t = await buildToday(db, await settings(db, { new_per_day: 4 }), NOON);
  assert.deepEqual(ids(t.fresh), ['w2', 'w3', 'w4'], '4 − 오늘 이미 배운 1');
});

test('연습 재료: 범위 · 틀린 단어(마지막 결과가 틀림) · 보기 재료 · 없는 단어는 건너뜀', async () => {
  const db = fakeD1();
  seed(db);
  db.raw.prepare("UPDATE cards SET last_review = '2026-10-26T02:00:00.000Z' WHERE word_id = 'r1'").run();
  db.raw.prepare("UPDATE cards SET last_review = '2026-10-21T02:00:00.000Z' WHERE word_id IN ('r2', 'r3')").run();
  const s = await settings(db);
  assert.deepEqual(ids((await practiceItems(db, s, 'today', 10, NOON)).items), ['r1']);
  assert.equal((await practiceItems(db, s, 'week', 10, NOON)).items.length, 3);
  const all = await practiceItems(db, s, 'all', 10, NOON);
  assert.equal(all.pool.length, 3 + 8, '배운 3 + 안 배운 B1 8');
  assert.deepEqual(Object.keys(all.pool[0]).sort(), ['gender', 'gloss_ko', 'id', 'lemma', 'pos']);

  await savePractice(db, { mode: 'cloze', results: [
    { word_id: 'r1', correct: false, at: '2026-10-26T03:00:00Z' },
    { word_id: 'r2', correct: false, at: '2026-10-26T03:00:01Z' },
    { word_id: 'r2', correct: true, at: '2026-10-26T03:00:02Z' },
    { word_id: 'nope', correct: true, at: '2026-10-26T03:00:03Z' },
  ] });
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM practice').get().n, 3);
  assert.deepEqual(ids((await practiceItems(db, s, 'wrong', 10, NOON)).items), ['r1'], 'r2 는 다시 맞힘');
  await assert.rejects(() => savePractice(db, { mode: 'nope', results: [] }), /bad_request/);
  await assert.rejects(() => savePractice(db, { mode: 'pick', results: [{ word_id: 'r1', correct: 1, at: 'x' }] }), /bad_result/);
  // 예전 방식(pick) 결과도 받는다(옛 화면이 기기에 남아 있을 때)
  assert.equal((await savePractice(db, { mode: 'pick', results: [] })).count, 0);
});

test('연습에서 틀린 배운 단어 → 「다시」 채점(아직 잘 모르는 단어) · 가중형 미루기(첫 틀림 모레·또 틀리면 내일) · 오늘 몫에 이미 있으면 그대로 · 한 번만', async () => {
  const db = fakeD1();
  seed(db);
  // r3 = 다음 학습일 마감(오늘 몫 아님) · r2 = 오늘 마감(이미 오늘 몫) · w1 = 안 배운 카드
  db.raw.prepare("UPDATE cards SET stability = 12, difficulty = 5, reps = 4, last_review = '2026-10-14T00:00:00.000Z', scheduled_days = 12 WHERE word_id IN ('r2', 'r3')").run();
  const s = await settings(db);
  const before = await buildToday(db, s, NOON);
  assert.deepEqual(ids(before.due), ['r1', 'r2']);
  const r = await savePractice(db, { mode: 'match', results: [
    { word_id: 'r3', correct: false, at: '2026-10-26T02:59:00Z' },
    { word_id: 'r3', correct: false, at: '2026-10-26T02:59:30Z' },
    { word_id: 'r2', correct: false, at: '2026-10-26T02:59:40Z' },
    { word_id: 'w1', correct: false, at: '2026-10-26T02:59:50Z' },
    { word_id: 'r1', correct: true, at: '2026-10-26T02:59:55Z' },
  ] }, NOON);
  assert.deepEqual(r, { ok: true, count: 5, relearn: ['r3'] });
  const c = db.raw.prepare("SELECT state, due, lapses, scheduled_days FROM cards WHERE word_id = 'r3'").get();
  assert.equal(c.state, 3, 'Relearning');
  assert.equal(c.lapses, 0, '연습 틀림은 잊은 수로 안 센다(8번에 쉬게 되지 않게)');
  assert.equal(c.due, '2026-10-27T19:00:00.000Z', '첫 틀림은 모레 학습일 시작에');
  assert.equal(c.scheduled_days, 2);
  const rev = db.raw.prepare("SELECT rating, reviewed_at, session_id FROM reviews WHERE word_id = 'r3'").all();
  assert.deepEqual(rev.map((x) => ({ ...x })), [{ rating: 1, reviewed_at: '2026-10-26T02:59:00.000Z', session_id: 'practice' }], '첫 틀림 시각으로 한 줄');
  assert.equal(db.raw.prepare("SELECT state FROM cards WHERE word_id = 'r2'").get().state, 2, '이미 오늘 몫이면 그대로');
  assert.equal(db.raw.prepare("SELECT state FROM cards WHERE word_id = 'w1'").get().state, 0, '안 배운 카드는 그대로');
  const after = await buildToday(db, s, NOON);
  assert.deepEqual(ids(after.due).sort(), ['r1', 'r2'], '미룬 카드는 오늘 몫에 안 나온다');
  assert.equal(after.reviewed_today, 0, '연습 「다시」 줄은 오늘 채점 수에 안 든다');
  assert.deepEqual(after.ratings, { good: 0, again: 0 });
  // 또 틀리면 내일로 당겨진다(자주 틀릴수록 빨리)
  const again = await savePractice(db, { mode: 'cloze', results: [{ word_id: 'r3', correct: false, at: '2026-10-26T03:01:00Z' }] }, NOON);
  assert.deepEqual(again.relearn, ['r3']);
  assert.equal(db.raw.prepare("SELECT due FROM cards WHERE word_id = 'r3'").get().due, '2026-10-26T19:00:00.000Z', '또 틀리면 내일');
  assert.equal(db.raw.prepare("SELECT lapses FROM cards WHERE word_id = 'r3'").get().lapses, 0);
});

test('연습 「다시」: 기기 시각이 마지막 채점보다 앞이면 마지막 채점 시각으로 당긴다', async () => {
  const db = fakeD1();
  seed(db);
  db.raw.prepare("UPDATE cards SET stability = 12, difficulty = 5, reps = 4, last_review = '2026-10-26T02:50:00.000Z', scheduled_days = 12 WHERE word_id = 'r3'").run();
  await savePractice(db, { mode: 'cloze', results: [{ word_id: 'r3', correct: false, at: '2026-10-20T00:00:00Z' }] }, NOON);
  assert.equal(db.raw.prepare("SELECT reviewed_at FROM reviews WHERE word_id = 'r3'").get().reviewed_at, '2026-10-26T02:50:00.000Z');
});

test('설정이 바뀌어도 더 받은 수는 그대로 — 그만큼 더 고른다(하루 상한이 풀리지 않게)', async () => {
  const db = fakeD1();
  for (let i = 1; i <= 30; i++) addWord(db, { id: `w${i}`, lemma: `Wort${i}`, seq: i });
  const s = await settings(db);
  await buildToday(db, s, NOON);
  await addExtra(db, s, NOON);
  await dropPlan(db, NOON).run();
  const t = await buildToday(db, await settings(db, { new_per_day: 3 }), NOON);
  assert.equal(t.plan.extra, 5);
  assert.equal(t.fresh.length, 8, '3 + 더 받은 5');
});
