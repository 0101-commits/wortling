// 학습 로직 L5~L7(2026-10-30): 흔들림 · 약한 단어/쉬는 카드 · 비슷한 단어 같은 날 금지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1, addWord } from './d1.mjs';
import { applyRating, EASY_MAX_DAYS } from '../worker/fsrs.ts';
import { addExtra, ensurePlan, loadSettings, pickDistinct, similarWords, wakeSuspended } from '../worker/deck.ts';
import { reviewQueue } from '../worker/words.ts';
import { practiceItems } from '../worker/practice.ts';
import { studyDay } from '../worker/time.ts';
import { intervalLabel, intervals, isWeak, nextCard } from '../src/deck.ts';
import { makeQuestions } from '../src/practice.ts';

const NOON = new Date('2026-10-26T03:00:00Z');
const DAY = 86400_000;
const row = (over = {}) => ({
  word_id: 'x', state: 2, due: NOON.toISOString(), stability: 20, difficulty: 5, elapsed_days: 20, scheduled_days: 20,
  learning_steps: 0, reps: 5, lapses: 0, last_review: new Date(NOON.getTime() - 20 * DAY).toISOString(), introduced_at: '2026-01-01T00:00:00.000Z', suspended: 0, ...over,
});

test('L5: 흔들림 켬 — 서버·앱이 같은 마감 · 미리보기 글자도 실제와 같다 · 같은 날 배운 단어가 흩어진다 · 쉬움 상한은 흔들림 뒤에도', () => {
  for (const id of ['a1', 'b2', 'c3', 'd4']) {
    for (const stability of [3, 20, 90]) {
      const c = row({ word_id: id, stability, scheduled_days: stability, elapsed_days: stability, last_review: new Date(NOON.getTime() - stability * DAY).toISOString() });
      const labels = intervals(c, NOON);
      for (const r of [1, 2, 3, 4]) {
        const srv = applyRating(c, r, NOON).nextRow;
        const cli = nextCard(c, r, NOON);
        assert.equal(cli.due, srv.due, `${id} s${stability} r${r}`);
        assert.deepEqual(cli, srv);
        assert.equal(labels[r], intervalLabel(Date.parse(srv.due) - NOON.getTime()), `글자 ${id} s${stability} r${r}`);
      }
      assert.ok(applyRating(c, 4, NOON).nextRow.scheduled_days <= EASY_MAX_DAYS);
    }
  }
  const days = new Set(Array.from({ length: 12 }, (_, i) => applyRating(row({ word_id: `w${i}` }), 3, NOON).nextRow.scheduled_days));
  assert.ok(days.size > 1, `12장이 모두 같은 간격: ${[...days]}`);
  assert.equal(applyRating(row({ word_id: 'z', stability: 200 }), 4, NOON).nextRow.scheduled_days, EASY_MAX_DAYS);
  // 같은 입력은 늘 같은 결과
  assert.equal(applyRating(row({ word_id: 'q' }), 3, NOON).nextRow.due, applyRating(row({ word_id: 'q' }), 3, NOON).nextRow.due);
});

test('L6: 새로 잊어 8번째가 되면 쉼(suspended_at) · 30일 뒤 깨움 · 깬 카드는 좋음으로는 다시 안 쉼', async () => {
  assert.equal(isWeak({ lapses: 3 }), false);
  assert.equal(isWeak({ lapses: 4 }), true);
  const seven = row({ lapses: 7 });
  const r = applyRating(seven, 1, NOON).nextRow;
  assert.equal(r.suspended, 1);
  assert.equal(r.suspended_at, NOON.toISOString());
  assert.deepEqual(nextCard(seven, 1, NOON), r, '앱 계산도 같다');
  assert.equal(applyRating(row({ lapses: 6 }), 1, NOON).nextRow.suspended, 0);

  const db = fakeD1();
  addWord(db, { id: 's1', lemma: 'Aaaaa', seq: 1, state: 2, due: '2026-10-01T00:00:00.000Z', introduced_at: '2026-01-01T00:00:00.000Z' });
  addWord(db, { id: 's2', lemma: 'Bbbbb', seq: 2, state: 2, due: '2026-10-01T00:00:00.000Z', introduced_at: '2026-01-01T00:00:00.000Z' });
  db.raw.prepare("UPDATE cards SET suspended = 1, lapses = 8, suspended_at = ? WHERE word_id = 's1'").run(new Date(NOON.getTime() - 31 * DAY).toISOString());
  db.raw.prepare("UPDATE cards SET suspended = 1, lapses = 8, suspended_at = ? WHERE word_id = 's2'").run(new Date(NOON.getTime() - 29 * DAY).toISOString());
  await wakeSuspended(db, NOON);
  const st = (id) => db.raw.prepare('SELECT suspended, suspended_at FROM cards WHERE word_id = ?').get(id);
  assert.deepEqual({ ...st('s1') }, { suspended: 0, suspended_at: null });
  assert.equal(st('s2').suspended, 1);
  const woke = db.raw.prepare('SELECT * FROM cards WHERE word_id = ?').get('s1');
  assert.equal(applyRating(woke, 3, NOON).nextRow.suspended, 0);
});

test('L6: 약한 단어는 예문 검토 큐에서 먼저 · 연습 재료에서 먼저 · 쓰기 문제에서 먼저', async () => {
  const db = fakeD1();
  const old = { state: 2, due: '2026-10-20T00:00:00.000Z', introduced_at: '2026-10-01T00:00:00.000Z' };
  addWord(db, { id: 'n1', lemma: 'Alpha', seq: 1 });
  addWord(db, { id: 'k1', lemma: 'Beta', seq: 2, ...old });
  addWord(db, { id: 'k2', lemma: 'Gamma', seq: 3, ...old });
  addWord(db, { id: 'k3', lemma: 'Delta', seq: 4, ...old });
  db.raw.prepare("UPDATE cards SET lapses = 5, last_review = '2026-10-19T00:00:00.000Z' WHERE word_id = 'k3'").run();
  db.raw.prepare("UPDATE cards SET lapses = 4, last_review = '2026-10-19T00:00:00.000Z' WHERE word_id = 'k2'").run();
  db.raw.prepare("UPDATE cards SET last_review = '2026-10-19T00:00:00.000Z' WHERE word_id = 'k1'").run();
  const q = await reviewQueue(db, 10, NOON);
  assert.deepEqual(q.slice(0, 2).map((w) => w.id), ['k3', 'k2'], '많이 잊은 순으로 맨 앞');
  // 최근 검토한 약한 단어는 7일 동안 약한 단어 몫에서 빠진다
  db.raw.prepare("UPDATE words SET checked_at = '2026-10-24T00:00:00.000Z' WHERE id = 'k3'").run();
  assert.equal((await reviewQueue(db, 10, NOON))[0].id, 'k2');

  const s = await loadSettings(db);
  const p = await practiceItems(db, s, 'all', 1, NOON);
  assert.ok(['k2', 'k3'].includes(p.items[0].word.id), '약한 단어가 먼저(n=1 → 하나)');

  const item = (id, lapses) => ({ word: { id, lemma: id, gloss_ko: '뜻', pos: 'noun', gender: null, plural: null }, card: row({ word_id: id, lapses }) });
  for (let t = 0; t < 20; t++) {
    const qs = makeQuestions('write', [item('a', 0), item('b', 0), item('c', 4), item('d', 0)], [], 1);
    assert.equal(qs[0].item.word.id, 'c');
  }
});

test('L7: 비슷한 단어 판정 — 관사·sich 무시 · 움라우트 무시 · 앞 다섯 글자 · 같은 뿌리', () => {
  assert.equal(similarWords('arbeiten', 'die Arbeit'), true);
  assert.equal(similarWords('sich ärgern', 'Ärger'), true);
  assert.equal(similarWords('Mütter', 'mutter'), true);
  assert.equal(similarWords('Tag', 'Tagebuch'), false);
  assert.equal(similarWords('Tag', 'Tage'), false);
  assert.equal(similarWords('Bau', 'Baum'), false);
  assert.equal(similarWords('Tag', 'Tagung'), false);
  assert.equal(similarWords('Küche', 'Kuchen'), true);
  assert.equal(similarWords('Arbeit', 'Arbeiter'), true);
  assert.equal(similarWords('Verkehr', 'Verkauf'), false);
  assert.equal(similarWords('Haus', 'Hand'), false);
  assert.equal(similarWords('über', 'Uhr'), false);
});

test('L7: 비슷한 후보만 남아도 그날 몫 n 개는 채운다(건너뛴 후보로 차례대로 보충)', () => {
  const c = ['Arbeit', 'arbeiten', 'Arbeiter', 'Freude'].map((lemma) => ({ lemma }));
  assert.deepEqual(pickDistinct(c, [], 3).map((x) => x.lemma), ['Arbeit', 'Freude', 'arbeiten']);
  assert.deepEqual(pickDistinct(c, [], 2).map((x) => x.lemma), ['Arbeit', 'Freude']);
  assert.equal(pickDistinct(c, ['Arbeit'], 4).length, 4);
});

test('L6: 약한 단어는 앞에 서되 절반까지 · 검토 큐도 절반까지', async () => {
  const item = (id, lapses) => ({ word: { id, lemma: id, gloss_ko: '뜻', pos: 'noun', gender: null, plural: null }, card: row({ word_id: id, lapses }) });
  const items = [item('w1', 5), item('w2', 5), item('w3', 5), item('w4', 5), item('a', 0), item('b', 0), item('c', 0), item('d', 0)];
  for (let t = 0; t < 10; t++) {
    const ids = makeQuestions('write', items, [], 4).map((q) => q.item.word.id);
    assert.equal(ids.filter((x) => x.startsWith('w')).length, 2, ids.join());
  }
  const db = fakeD1();
  const old = { state: 2, due: '2026-10-20T00:00:00.000Z', introduced_at: '2026-10-01T00:00:00.000Z' };
  ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].forEach((l, i) => addWord(db, { id: `x${i}`, lemma: l, seq: i + 1, ...old }));
  for (let i = 0; i < 4; i++) db.raw.prepare("UPDATE cards SET lapses = 5, last_review = '2026-10-19T00:00:00.000Z' WHERE word_id = ?").run(`x${i}`);
  const q = await reviewQueue(db, 4, NOON);
  assert.deepEqual(q.slice(0, 2).map((w) => w.id).sort(), ['x0', 'x1']);
  const s = await loadSettings(db);
  const p = await practiceItems(db, s, 'all', 2, NOON);
  assert.equal(p.items.filter((i) => Number(i.card.lapses) >= 4).length, 2);
});

test('L7: 오늘 새 단어 목록에서 비슷한 단어는 건너뛰고 다른 날 후보로 남는다 · 더 받기도 같은 규칙', async () => {
  const db = fakeD1();
  const lemmas = ['Arbeit', 'arbeiten', 'Freude', 'Küche', 'Kuchen', 'Zeitung', 'Brot', 'Dach', 'Eisen', 'Gabel', 'Himmel', 'Insel', 'Jacke', 'Kamel', 'Lampe'];
  lemmas.forEach((l, i) => addWord(db, { id: `n${i}`, lemma: l, seq: i + 1 }));
  const s = { ...(await loadSettings(db)), new_per_day: 4 };
  const plan = await ensurePlan(db, s, studyDay(NOON));
  const names = plan.fresh.map((id) => lemmas[Number(id.slice(1))]);
  assert.deepEqual(names, ['Arbeit', 'Freude', 'Küche', 'Zeitung']);
  // 건너뛴 단어는 새 카드로 남아 있다 → 다음 날 계획에 오른다
  db.raw.prepare("UPDATE cards SET state = 2, introduced_at = '2026-10-20T00:00:00.000Z', due = '2026-11-20T00:00:00.000Z' WHERE word_id = 'n0'").run();
  const next = await ensurePlan(db, s, '2026-10-27');
  assert.ok(next.fresh.includes('n1'));
  // 더 받기: 계획에 든 Arbeit/Küche 와 비슷한 arbeiten · Kuchen 은 안 들어온다
  await addExtra(db, s, NOON);
  const after = JSON.parse(db.raw.prepare('SELECT fresh FROM day_plans WHERE day = ?').get(studyDay(NOON)).fresh).map((id) => lemmas[Number(id.slice(1))]);
  assert.ok(!after.includes('arbeiten') && !after.includes('Kuchen'), after.join());
  assert.ok(after.length > 4);
});
