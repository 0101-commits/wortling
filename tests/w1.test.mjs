// 기획 v8 W1: 예문 속 표제어 낱말(example_hit) — 찾기 규칙으로 못 찾는 꼴(불규칙 · 분리동사)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clozeOf, findAll, findWord, hitSpans } from '../shared/cloze.ts';
import { acceptHits, hitMisses, hitsPrompt } from '../scripts/words/lib.mjs';
import { clozeParts, pickTokens } from '../src/practice.ts';
import { fakeD1, addWord } from './d1.mjs';
import { exampleWords, patchWords, revertChange, listChanges } from '../worker/words.ts';

const DE = 'Ich gebe nicht auf, auch wenn es schwer ist.';

test('findWord: 규칙으로 못 찾으면 hit 의 첫 낱말 · findAll 은 분리동사 두 조각 · 규칙으로 찾으면 hit 안 씀', () => {
  assert.equal(findWord(DE, 'aufgeben'), null);
  assert.deepEqual(findWord(DE, 'aufgeben', 'gebe|auf'), [4, 8]);
  assert.deepEqual(findAll(DE, 'aufgeben', 'gebe|auf').map(([s, e]) => DE.slice(s, e)), ['gebe', 'auf']);
  assert.deepEqual(findAll(DE, 'aufgeben', '-'), []);
  assert.equal(clozeOf('Der Feuerwehrmann hat die Katze gerettet.', 'retten', 'gerettet'), 'Der Feuerwehrmann hat die Katze ＿＿＿.');
  // 규칙으로 찾는 단어는 hit 가 틀려도 규칙대로
  assert.deepEqual(findWord('Wir müssen die Umwelt schützen.', 'Umwelt', 'xyz'), [15, 21]);
  // 예문에 없는 낱말은 건너뜀
  assert.deepEqual(hitSpans(DE, 'nimmt|auf'), [[15, 18]]);
});

test('더 공부하기: 분리동사 빈칸은 앞 조각, 짚기는 두 조각 다 정답', () => {
  assert.deepEqual(clozeParts(DE, 'aufgeben', 'gebe|auf'), { before: 'Ich ', hit: 'gebe', after: ' nicht auf, auch wenn es schwer ist.' });
  const t = pickTokens(DE, 'aufgeben', 'gebe|auf');
  assert.deepEqual(t.filter((x) => x.hit).map((x) => x.text), ['gebe', 'auf,']);
  assert.equal(pickTokens(DE, 'aufgeben', null), null);
});

test('hits: 규칙으로 못 찾는 것만 묻고, 예문에 정말 있는 낱말만 적음(없으면 -) · 재귀대명사 뺌', () => {
  const list = [
    { id: 'a', lemma: 'aufgeben', example_de: DE },
    { id: 'b', lemma: 'Umwelt', example_de: 'Wir müssen die Umwelt schützen.' },
    { id: 'c', lemma: 'sich irren', example_de: 'Da irrst du dich, der Bus fährt um acht.' },
    { id: 'd', lemma: 'werfen', example_de: 'Wirf mir bitte den Ball zu!' },
  ];
  assert.deepEqual(hitMisses(list).map((w) => w.id), ['a', 'c', 'd']);
  assert.ok(hitsPrompt(hitMisses(list)).includes('"lemma":"aufgeben"'));
  const got = acceptHits(
    [
      { id: 'a', forms: ['gebe', 'auf'] },
      { id: 'c', forms: ['irrst', 'dich'] },
      { id: 'd', forms: ['wirft'] }, // 예문에 없음(지어냄) → -
      { id: 'zzz', forms: ['x'] },
    ],
    hitMisses(list),
  );
  assert.deepEqual([...got], [['a', 'gebe|auf'], ['c', 'irrst'], ['d', '-']]);
});

test('worker: example_hit 저장 · 형식 검사 · 예문이 바뀌거나 되돌리면 지움 · 후보 목록', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w1', lemma: 'aufgeben', pos: 'verb', example_de: DE, example_ko: '포기 안 해요' });
  addWord(db, { id: 'w2', lemma: 'Umwelt', example_de: 'Wir müssen die Umwelt schützen.' });
  assert.equal((await exampleWords(db)).items.length, 2);
  await patchWords(db, [{ id: 'w1', example_hit: 'gebe|auf' }]);
  const hit = () => db.raw.prepare("SELECT example_hit AS h FROM words WHERE id = 'w1'").get().h;
  assert.equal(hit(), 'gebe|auf');
  assert.deepEqual((await exampleWords(db)).items.map((w) => w.id), ['w2'], '적힌 단어는 후보에서 빠짐');
  await assert.rejects(() => patchWords(db, [{ id: 'w1', example_hit: 'a b' }]), /bad example_hit/);
  await assert.rejects(() => patchWords(db, [{ id: 'w1', example_hit: 'a|b|c|d|e' }]), /bad example_hit/);
  // 검토가 예문을 바꾸면 지움
  await patchWords(db, [{ id: 'w1', example_de: 'Gib nicht auf!', changes: [{ field: 'example_de', old: DE, new: 'Gib nicht auf!', applied: 1 }] }]);
  assert.equal(hit(), null);
  await patchWords(db, [{ id: 'w1', example_hit: 'Gib|auf' }]);
  // 사용자가 예문을 되돌려도 지움
  await revertChange(db, (await listChanges(db, 1))[0].id);
  assert.equal(hit(), null);
});
