// 최종 검토에서 미뤄 둔 사소한 문제 12건(2026-10-15) — 순수 함수 쪽 시험
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromShare } from '../src/share.ts';
import { serverErrorText } from '../src/errors.ts';
import { REQ_TEXT } from '../shared/request.ts';
import { buildIndex } from '../scripts/words/sources.mjs';
import { newsItems, newsProblems } from '../scripts/words/lib.mjs';

test('공유하기: 주소와 같이 온 글은 3낱말 이하만 단어 칸으로, 둘레 따옴표는 뗀다', () => {
  const q = (o) => new URLSearchParams(o);
  assert.deepEqual(fromShare(q({ text: 'Polizei ermittelt in Hamburg', url: 'https://www.ndr.de/a' })), { word: '', url: 'https://www.ndr.de/a' });
  assert.deepEqual(fromShare(q({ text: '„Ermittlung“', url: 'https://www.dw.com/de/x' })), { word: 'Ermittlung', url: 'https://www.dw.com/de/x' });
  assert.deepEqual(fromShare(q({ text: 'die Daumen drücken https://x.de/a' })), { word: 'die Daumen drücken', url: 'https://x.de/a' });
  // 주소 없이 온 글은 예전처럼(단어 꼴이면 그대로)
  assert.deepEqual(fromShare(q({ text: 'Polizei ermittelt in Hamburg' })), { word: 'Polizei ermittelt in Hamburg', url: '' });
});

test('서버 오류 문구: 알려진 코드는 우리말, 모르는 코드는 상태 번호 + 코드', () => {
  assert.equal(serverErrorText(409, 'changed_since'), '그 뒤에 카드가 또 바뀌어서 되돌릴 수 없어요.');
  assert.equal(serverErrorText(409, 'not_revertible'), '되돌릴 수 없는 항목이에요.');
  assert.equal(serverErrorText(400, 'bad_text'), '글자로 된 단어 하나(60자 이내)만 넣어 주세요.');
  assert.equal(serverErrorText(400, 'bad_url'), '링크는 https:// 로 시작하는 주소만 넣을 수 있어요.');
  assert.equal(serverErrorText(500, 'internal'), '서버 오류 500 · internal');
  assert.equal(serverErrorText(502), '서버 오류 502');
});

test('단어 넣기 규칙: 「tagesschau.de」 같은 주소 꼴은 안 됨, 「z. B.」·「usw.」는 됨', () => {
  for (const ok of ['Ermittlung', 'z. B.', 'usw.', 'die Daumen drücken', "Kopf-an-Kopf-Rennen"]) assert.ok(REQ_TEXT.test(ok), ok);
  for (const no of ['tagesschau.de', 'www.dw.com', 'ndr.de/a']) assert.equal(REQ_TEXT.test(no), false, no);
});

test('색인: 동음 표제어의 복수형이 서로 다르면 「모름」(Bank: Banken / Bänke)', async () => {
  const kaikki = [
    { word: 'Bank', pos: 'noun', forms: [{ form: 'Banken', tags: ['plural'] }], senses: [{ glosses: ['bank (money)'], tags: ['feminine'] }] },
    { word: 'Bank', pos: 'noun', forms: [{ form: 'Bänke', tags: ['plural'] }], senses: [{ glosses: ['bench'], tags: ['feminine'] }] },
    { word: 'Haus', pos: 'noun', forms: [{ form: 'Häuser', tags: ['plural'] }], senses: [{ glosses: ['house'], tags: ['neuter'] }] },
    { word: 'Haus', pos: 'noun', forms: [{ form: 'Häuser', tags: ['plural'] }], senses: [{ glosses: ['household'], tags: ['neuter'] }] },
  ].map((o) => JSON.stringify(o));
  const ix = await buildIndex({ kaikkiLines: kaikki, daflexText: '"word"\t"tag"\n', leipzigText: '1\tBank\t9\n2\tHaus\t9\n', month: '2026-10' });
  assert.deepEqual(ix.facts['Bank|noun'], { g: ['die'], en: 'bank (money)' }, '복수 칸 없음 = 모름');
  assert.deepEqual(ix.facts['Haus|noun'], { g: ['das'], pl: 'Häuser', en: 'house' });
});

test('뉴스 받기: 두 곳 다 실패면 오류로(알림), 한 곳만 실패면 오류 아님', () => {
  assert.deepEqual(newsProblems({ tagesschau: 452, ndr: 12 }), []);
  assert.deepEqual(newsProblems({ tagesschau: '실패 503', ndr: 12 }), []);
  assert.deepEqual(newsProblems({ tagesschau: '실패 503', ndr: '실패 timeout' }), ['뉴스 못 받음 — tagesschau 실패 503 · ndr 실패 timeout']);
  assert.deepEqual(newsProblems({ tagesschau: 0, ndr: 0 }), ['뉴스 못 받음 — tagesschau 0 · ndr 0']);
});

test('뉴스 수 보내기: 서버가 안 받는 열쇠(60자 넘는 기본형 등)는 미리 뺀다', () => {
  const counts = new Map([
    ['Vorfall|noun', { n: 2, url: 'https://a' }],
    [`${'X'.repeat(61)}|noun`, { n: 1, url: null }],
    ['Kopf|Noun', { n: 1, url: null }],
    ['Haus|noun', { n: 1, url: 'http://kein-https' }],
  ]);
  assert.deepEqual(newsItems(counts), [{ key: 'Vorfall|noun', n: 2, url: 'https://a' }, { key: 'Haus|noun', n: 1, url: null }]);
});

import { indexFresh, INDEX_VERSION } from '../scripts/words/sources.mjs';
test('색인 다시 만들기: 달이 같아도 만드는 규칙(판)이 바뀌었으면 새로', () => {
  assert.equal(indexFresh({ month: '2026-10', v: INDEX_VERSION }, '2026-10'), true);
  assert.equal(indexFresh({ month: '2026-10' }, '2026-10'), false, '판 번호 없는 예전 색인');
  assert.equal(indexFresh({ month: '2026-09', v: INDEX_VERSION }, '2026-10'), false);
  assert.equal(indexFresh(null, '2026-10'), false);
});
