// 미뤄 둔 문제 고친 것의 검토 반영(2026-10-15 2차)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fakeD1, addWord } from './d1.mjs';
import { LIST_ORDER, reseq } from '../worker/words.ts';
import { REQ_TEXT } from '../shared/request.ts';
import { serverErrorText } from '../src/errors.ts';
import { setOutput } from '../scripts/admin.mjs';

test('단어 목록 「학습 순서」: 배운 카드가 늘 앞, 그다음 안 배운 카드 순서', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Alt', seq: 1, state: 2, introduced_at: '2026-10-01T00:00:00.000Z' });
  // 배포 뒤에 배운 카드 = 배운 때의 큰 열쇠를 그대로 가짐
  addWord(db, { id: 'w0002', lemma: 'Wahl', seq: 5500000300, state: 2, introduced_at: '2026-10-16T00:00:00.000Z' });
  addWord(db, { id: 'w0003', lemma: 'Krieg', seq: 1, news_rank: 200 });
  await reseq(db, new Date('2026-10-17T00:00:00Z'));
  const order = db.raw.prepare(`SELECT w.lemma FROM words w JOIN cards c ON c.word_id = w.id ORDER BY ${LIST_ORDER}`).all().map((r) => r.lemma);
  assert.deepEqual(order, ['Alt', 'Wahl', 'Krieg']);
});

test('단어 넣기: 붙여 쓴 줄임말(z.B.·d.h.·u.a.)은 되고 주소 꼴은 안 됨', () => {
  for (const ok of ['z.B.', 'd.h.', 'u.a.', 'z. B.', 'usw.', 'Ermittlung']) assert.ok(REQ_TEXT.test(ok), ok);
  for (const no of ['tagesschau.de', 'www.dw.com', 'ndr.de']) assert.equal(REQ_TEXT.test(no), false, no);
});

test('모르는 오류 코드는 상태 번호와 같이 보인다(원인 짚기)', () => {
  assert.equal(serverErrorText(400, 'bad_review'), '서버 오류 400 · bad_review');
  assert.equal(serverErrorText(409, 'changed_since'), '그 뒤에 카드가 또 바뀌어서 되돌릴 수 없어요.');
  assert.equal(serverErrorText(502), '서버 오류 502');
});

test('setOutput: GitHub Actions 단계 출력(GITHUB_OUTPUT)에 한 줄, 없으면 아무것도 안 함', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wortling-'));
  const f = path.join(dir, 'out');
  const before = process.env.GITHUB_OUTPUT;
  try {
    process.env.GITHUB_OUTPUT = f;
    setOutput('rebuilt', '1');
    assert.equal(readFileSync(f, 'utf8'), 'rebuilt=1\n');
    delete process.env.GITHUB_OUTPUT;
    assert.doesNotThrow(() => setOutput('rebuilt', '1'));
  } finally {
    if (before === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = before;
    rmSync(dir, { recursive: true, force: true });
  }
});
