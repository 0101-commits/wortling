// 최종 검토에서 미뤄 둔 사소한 문제 — DB 쪽 시험(D1 흉내)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1, addWord } from './d1.mjs';
import { addRequest, insertWords, listChanges, listRequests, patchWords, reseq, revertChange, settleRequest } from '../worker/words.ts';

const NOW = new Date('2026-10-15T00:00:00Z');
const row = (db, sql) => ({ ...db.raw.prepare(sql).get() });

test('뜻 되돌리기: 내 뜻(mine)으로 두고 그림은 다시 그린다', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Umzug', gloss_ko: '이사', gloss_status: 'checked', image_status: 'ok' });
  await patchWords(db, [{ id: 'w0001', gloss_ko: '이사', changes: [{ field: 'gloss_ko', old: '이동', new: '이사', applied: 1 }] }], NOW);
  db.raw.prepare("UPDATE words SET image_status = 'ok', gloss_status = 'checked'").run();
  await revertChange(db, (await listChanges(db, 1))[0].id, NOW);
  assert.deepEqual(row(db, 'SELECT gloss_ko, gloss_status, image_status FROM words'), { gloss_ko: '이동', gloss_status: 'mine', image_status: 'none' });
});

test('reseq: 새 단어가 끼어들어도 다른 카드의 seq 는 안 바뀐다(쓰기 줄 수)', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Gelernt', seq: 1, state: 2, introduced_at: '2026-10-01T00:00:00.000Z' });
  for (let i = 2; i <= 6; i++) addWord(db, { id: `w000${i}`, lemma: `Wort${i}`, seq: i, news_rank: i * 100 });
  await reseq(db, NOW);
  await insertWords(db, [{ lemma: 'Mitte', pos: 'noun', level: 'B1', level_src: 'news', news_rank: 350 }]);
  const r = await reseq(db, NOW);
  assert.equal(r.moved, 1, '새 단어 하나만');
  const order = db.raw.prepare('SELECT lemma FROM words ORDER BY seq, lemma').all().map((x) => x.lemma);
  assert.deepEqual(order, ['Gelernt', 'Wort2', 'Wort3', 'Mitte', 'Wort4', 'Wort5', 'Wort6']);
});

test('넣은 단어 목록: 이미 배우는 단어면 learned', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', state: 2, introduced_at: '2026-10-01T00:00:00.000Z' });
  addWord(db, { id: 'w0002', lemma: 'Baum' });
  await addRequest(db, { text: 'Haus' }, NOW);
  await addRequest(db, { text: 'Baum' }, NOW);
  await settleRequest(db, 1, { status: 'exists', word_id: 'w0001' });
  await settleRequest(db, 2, { status: 'exists', word_id: 'w0002' });
  const list = await listRequests(db, undefined, 10);
  assert.deepEqual(list.map((r) => [r.text, r.learned]), [['Baum', false], ['Haus', true]]);
});

test('0005: 180일 지난 검토 줄 질의가 checked_at 색인을 탄다', () => {
  const db = fakeD1();
  const plan = db.raw.prepare("EXPLAIN QUERY PLAN SELECT w.id FROM words w WHERE w.checked_at < ? ORDER BY w.checked_at LIMIT 5").all('2026-04-01').map((r) => r.detail).join(' ');
  assert.match(plan, /words_checked_at/);
});
