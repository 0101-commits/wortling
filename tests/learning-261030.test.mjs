// 학습 로직 조정(2026-10-30): 쉬움 상한 · 연습 미루기 min · 다시 5장 뒤 · 밀린 복습이면 새 단어 줄이기 · 기억률 순
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1, addWord, lem } from './d1.mjs';
import { applyRating, retrievability, EASY_MAX_DAYS } from '../worker/fsrs.ts';
import { buildToday, freshAllowance, loadSettings } from '../worker/deck.ts';
import { savePractice } from '../worker/practice.ts';
import { studyDay } from '../worker/time.ts';
import { studyDay as clientStudyDay } from '../src/format.ts';
import { deckReducer, initDeck, nextCard, intervals, SWIPE } from '../src/deck.ts';

const NOON = new Date('2026-10-26T03:00:00Z');
const DAY = 86400_000;
const row = (over = {}) => ({
  word_id: 'x', state: 2, due: NOON.toISOString(), stability: 100, difficulty: 5, elapsed_days: 100, scheduled_days: 100,
  learning_steps: 0, reps: 5, lapses: 0, last_review: new Date(NOON.getTime() - 100 * DAY).toISOString(), introduced_at: '2026-01-01T00:00:00.000Z', suspended: 0, ...over,
});

test('L1: 쉬움은 FSRS 가 계산, 간격만 120일로 막는다 · 기억 수치는 그대로', () => {
  const big = row();
  const { nextRow, log } = applyRating(big, 4, NOON);
  assert.equal(nextRow.due, new Date(NOON.getTime() + EASY_MAX_DAYS * DAY).toISOString());
  assert.equal(nextRow.scheduled_days, EASY_MAX_DAYS);
  assert.ok(nextRow.stability > 120, '안정도는 막지 않는다');
  assert.equal(log.rating, 4);
  assert.equal(nextCard(big, 4, NOON).due, nextRow.due, '앱 계산도 같다');
  // 상한보다 짧게 나오면 FSRS 값 그대로(120일로 끌어올리지 않는다)
  const small = row({ stability: 3, scheduled_days: 3, elapsed_days: 3, last_review: new Date(NOON.getTime() - 3 * DAY).toISOString() });
  const e = applyRating(small, 4, NOON).nextRow;
  assert.ok(e.scheduled_days < EASY_MAX_DAYS && e.scheduled_days > 3, `쉬움 ${e.scheduled_days}일`);
  assert.equal(nextCard(small, 4, NOON).scheduled_days, e.scheduled_days);
  assert.notEqual(intervals(small, NOON)[4], '120일');
  assert.equal(intervals(big, NOON)[4], '120일');
});

async function practiceDue(due, prior) {
  const db = fakeD1();
  addWord(db, { id: 'p1', lemma: 'Morgen', state: 2, due, introduced_at: '2026-10-20T00:00:00.000Z' });
  db.raw.prepare("UPDATE cards SET stability = 5, difficulty = 5, last_review = '2026-10-22T03:00:00.000Z', reps = 3 WHERE word_id = 'p1'").run();
  if (prior) db.raw.prepare("INSERT INTO practice(mode, word_id, correct, at) VALUES ('cloze', 'p1', 0, '2026-10-24T00:00:00.000Z')").run();
  await savePractice(db, { mode: 'cloze', results: [{ word_id: 'p1', correct: false, at: '2026-10-26T03:00:00Z' }] }, NOON);
  return db.raw.prepare("SELECT due, scheduled_days FROM cards WHERE word_id = 'p1'").get().due;
}

test('L2: 연습에서 틀려도 새 마감 = min(원래, 미룬 날) — 내일 마감 카드가 모레로 밀리지 않는다', async () => {
  // 10-27 학습일 안(10-26T19:00Z~10-27T19:00Z) 마감 = 내일 몫 → 처음 틀려도(모레 후보) 그대로
  assert.equal(await practiceDue('2026-10-27T05:00:00.000Z', false), '2026-10-27T05:00:00.000Z');
  // 모레 이후 마감이면 모레로 당긴다
  assert.equal(await practiceDue('2026-11-10T00:00:00.000Z', false), '2026-10-27T19:00:00.000Z');
  // 또 틀리면 내일 시작(원래 마감이 더 늦음)
  assert.equal(await practiceDue('2026-11-10T00:00:00.000Z', true), '2026-10-26T19:00:00.000Z');
});

const item = (i) => ({ word: { id: `w${i}`, lemma: `W${i}` }, card: { word_id: `w${i}`, state: 2, due: NOON.toISOString(), stability: 5, difficulty: 5, elapsed_days: 0, scheduled_days: 5, learning_steps: 0, reps: 3, lapses: 0, last_review: new Date(NOON.getTime() - 5 * DAY).toISOString(), introduced_at: null, suspended: 0 } });

test('L3: 「다시」 카드는 5장 뒤에 다시 나온다(남은 카드가 적으면 맨 뒤)', () => {
  let s = initDeck(Array.from({ length: 12 }, (_, i) => item(i + 1)));
  s = deckReducer(s, { type: 'grade', rating: 1, at: NOON.toISOString() });
  assert.equal(SWIPE.RESHOW_GAP, 5);
  const ids = s.queue.map((q) => q.word.id);
  assert.equal(ids.indexOf('w1', 1), 6, '사이에 카드 5장');
  assert.equal(ids.length, 13);
  // 남은 카드 2장 → 맨 뒤
  let t = initDeck([item(1), item(2), item(3)]);
  t = deckReducer(t, { type: 'grade', rating: 1, at: NOON.toISOString() });
  assert.deepEqual(t.queue.map((q) => q.word.id), ['w1', 'w2', 'w3', 'w1']);
});

test('L4: 밀린 복습 > 100 이면 새 단어 절반, > 200 이면 0', () => {
  assert.deepEqual([100, 101, 200, 201].map((n) => freshAllowance(5, n)), [5, 2, 2, 0]);
});

function backlogDb(n, stabilityOf = () => 5) {
  const db = fakeD1();
  for (let i = 1; i <= 6; i++) addWord(db, { id: `n${i}`, lemma: lem(i), seq: i });
  for (let i = 1; i <= n; i++) addWord(db, { id: `r${i}`, lemma: `Alt${i}`, seq: 100 + i, state: 2, due: '2026-10-25T23:00:00.000Z', introduced_at: '2026-10-01T00:00:00.000Z' });
  db.raw.prepare("UPDATE cards SET last_review = '2026-10-20T03:00:00.000Z', stability = 5 WHERE state = 2").run();
  return db;
}

test('L4: 오늘 몫 새 단어 수가 밀린 복습에 따라 줄고, 복습은 기억률 낮은 순', async () => {
  const s = async (db) => ({ ...(await loadSettings(db)), new_per_day: 4 });
  const n = async (c) => { const db = backlogDb(c); return (await buildToday(db, await s(db), NOON)).fresh.length; };
  assert.equal(await n(50), 4);
  assert.equal(await n(150), 2);
  assert.equal(await n(250), 0);
  // 기억률 순: 같은 경과일이면 안정도 낮은 카드가 먼저, 마감이 이른 카드가 뒤여도
  const db = fakeD1();
  addWord(db, { id: 'hi', lemma: 'A', seq: 1, state: 2, due: '2026-10-25T20:00:00.000Z', introduced_at: '2026-10-01T00:00:00.000Z' });
  addWord(db, { id: 'lo', lemma: 'B', seq: 2, state: 2, due: '2026-10-26T10:00:00.000Z', introduced_at: '2026-10-01T00:00:00.000Z' });
  db.raw.prepare("UPDATE cards SET last_review = '2026-10-16T03:00:00.000Z', stability = CASE word_id WHEN 'hi' THEN 60 ELSE 4 END").run();
  const t = await buildToday(db, await s(db), NOON);
  assert.deepEqual(t.due.map((i) => i.word.id), ['lo', 'hi']);
  const c = (id) => retrievability(db.raw.prepare('SELECT * FROM cards WHERE word_id = ?').get(id), NOON);
  assert.ok(c('lo') < c('hi') && c('hi') < 1);
});

test('L4: 서버·앱의 학습일 경계가 같다(23:59 · 00:01 · 03:59 · 04:00 KST)', () => {
  for (const iso of ['2026-10-26T14:59:00Z', '2026-10-26T15:01:00Z', '2026-10-26T18:59:00Z', '2026-10-26T19:00:00Z', '2026-12-31T14:59:30Z']) {
    assert.equal(clientStudyDay(new Date(iso)), studyDay(new Date(iso)), iso);
  }
  assert.equal(studyDay(new Date('2026-10-26T14:59:00Z')), '2026-10-26', '23:59 KST');
  assert.equal(studyDay(new Date('2026-10-26T15:01:00Z')), '2026-10-26', '00:01 KST 는 아직 전날 학습일');
});
