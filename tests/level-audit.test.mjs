// scripts/words/level-audit.mjs 시험(네트워크·AI 키 없음) — DAFlex 읽기 · 응답 검증 · 빠진 번호 다시 묻기 · 요약
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, classify, parseDaflexRob, summarize, validate } from '../scripts/words/level-audit.mjs';

test('parseDaflexRob: NE 제외 · 관사 뗌 · rob 은 nb_doc≥2, any 는 level_freq>0', () => {
  const lv = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
  const head = ['word', 'tag', ...lv.map((l) => `level_freq@${l}`), ...lv.map((l) => `nb_doc@${l}`)].join('\t');
  const row = (w, t, f, d) => [`"${w}"`, `"${t}"`, ...f, ...d].join('\t');
  const m = parseDaflexRob([head,
    row('Haus', 'NN', [0, 3, 1, 0, 0, 0], [0, 1, 2, 0, 0, 0]),
    row('Berlin', 'NE', [5, 0, 0, 0, 0, 0], [5, 0, 0, 0, 0, 0]),
    row('Zorn', 'NN', [0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 1, 0]),
  ].join('\n'));
  assert.deepEqual(m.get('haus'), { rob: 'B1', any: 'A2' });
  assert.equal(m.has('berlin'), false);
  assert.deepEqual(m.get('zorn'), { rob: null, any: 'C1' });
});

test('validate: 범위 밖 번호 · 모르는 등급 · 중복 버림', () => {
  const g = validate([{ i: 0, lv: 'a1', conf: 'high' }, { i: 0, lv: 'B2' }, { i: 5, lv: 'B1' }, { i: 1, lv: 'X9' }, { i: 2, lv: 'C1', conf: '??' }], 3);
  assert.deepEqual([...g], [[0, { lv: 'A1', conf: 'high' }], [2, { lv: 'C1', conf: 'low' }]]);
});

test('classify: 빠진 번호는 원래 번호로 다시 묻는다', async () => {
  const batch = [{ lemma: 'Haus', pos: 'noun' }, { lemma: 'Zorn', pos: 'noun' }, { lemma: 'gehen', pos: 'verb' }];
  const prompts = [];
  const ask = async (p) => {
    prompts.push(p);
    return prompts.length === 1 ? [{ i: 0, lv: 'A1', conf: 'high' }, { i: 2, lv: 'A1', conf: 'high' }] : [{ i: 1, lv: 'C1', conf: 'mid' }];
  };
  const got = await classify(batch, ask);
  assert.equal(got.size, 3);
  assert.equal(got.get(1).lv, 'C1');
  assert.match(prompts[1], /^1\tZorn\tnoun$/m);
  assert.doesNotMatch(prompts[1], /Haus/);
  assert.match(buildPrompt(batch), /0\tHaus\tnoun/);
});

test('summarize: 등급 교차표와 A1·A2 일치 칸', () => {
  const r = (level, ai_lv, daflex_rob, learned, has_image) => ({ level, ai_lv, daflex_rob, learned, has_image });
  const s = summarize([r('B1', 'A1', 'A2', true, true), r('B1', 'A2', 'B2', false, true), r('B2', 'B2', 'A1', false, false), r('C1', 'C1', null, false, false)]);
  assert.deepEqual(s.low_buckets.both_A, { n: 1, learned: 1, has_image: 1 });
  assert.deepEqual(s.low_buckets.ai_only_A, { n: 1, learned: 0, has_image: 1 });
  assert.deepEqual(s.low_buckets.daflex_only_A, { n: 1, learned: 0, has_image: 0 });
  assert.equal(s.ai_lv_by_level.A1.B1, 1);
  assert.equal(s.daflex_rob_by_ai_lv.none.C1, 1);
});
