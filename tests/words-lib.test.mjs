// scripts/words/lib.mjs 순수 함수 시험(네트워크·파일 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptContent, acceptRequests, acceptVerdicts, cefr3, countNews, decide, exampleHasWord, factsFor, lemmatize,
  own, parseRss, parseTagesschau, pickCandidates, reviewPrompt, tokens, wordKey,
} from '../scripts/words/lib.mjs';

const INDEX = {
  forms: { Umzug: ['Umzug|noun'], Umzüge: ['Umzug|noun'], ermittelte: ['ermitteln|verb'], ermitteln: ['ermitteln|verb'], Vorfall: ['Vorfall|noun'], rief: ['anrufen|verb'], Bank: ['Bank|noun'] },
  facts: {
    'Umzug|noun': { g: ['der'], pl: 'Umzüge', en: 'move' },
    'ermitteln|verb': { en: 'to investigate' },
    'Vorfall|noun': { g: ['der'], pl: 'Vorfälle', en: 'incident' },
    'Haus|noun': { g: ['das'], pl: 'Häuser', en: 'house' },
    'EU|noun': { g: ['die'], pl: null, en: 'EU' },
    'Teil|noun': { g: ['der', 'das'], pl: 'Teile', en: 'part' },
  },
  daflex: { umzug: 'A2', ermitteln: 'B2', vorfall: 'B1', haus: 'A1', teil: 'A2' },
  leipzig: { 'Haus|noun': 3, 'Umzug|noun': 900, 'ermitteln|verb': 1200, 'Vorfall|noun': 30000, 'EU|noun': 5 },
};

test('wordKey · tokens · own', () => {
  assert.equal(wordKey('sich beschweren', 'verb'), 'beschweren|verb');
  assert.equal(wordKey('Umzug', 'noun'), 'Umzug|noun');
  assert.deepEqual(tokens('Der Umzug, ab 2026: Bund-Länder-Streit!'), ['Der', 'Umzug', 'Bund-Länder-Streit']);
  assert.equal(own({}, 'constructor'), undefined, '객체 기본 속성은 낱말이 아니다');
});

test('lemmatize: 대소문자 그대로, 문장 첫 낱말만 소문자로도', () => {
  assert.deepEqual(lemmatize('Ermittelte', INDEX, true), ['ermitteln|verb']);
  assert.deepEqual(lemmatize('Ermittelte', INDEX, false), []);
  assert.deepEqual(lemmatize('constructor', INDEX), []);
});

test('countNews: 한 기사 안 같은 열쇠는 1번, 마지막 링크', () => {
  const m = countNews([
    { title: 'Umzug: Polizei ermittelte nach Vorfall', text: 'Der Umzug war laut.', url: 'https://a' },
    { title: 'Vorfall in Hamburg', text: '', url: 'https://b' },
  ], INDEX);
  assert.deepEqual(m.get('Umzug|noun'), { n: 1, url: 'https://a' });
  assert.deepEqual(m.get('Vorfall|noun'), { n: 2, url: 'https://b' });
  assert.deepEqual(m.get('ermitteln|verb'), { n: 1, url: 'https://a' });
});

test('parseTagesschau · parseRss: 이상한 응답은 빈 목록', () => {
  assert.deepEqual(parseTagesschau({ news: [{ title: 'Zuckersteuer kommt', topline: 'Saarland', firstSentence: 'Lange wurde gestritten.', shareURL: 'https://www.sr.de/x' }, { title: 7 }] }),
    [{ title: 'Saarland Zuckersteuer kommt', text: 'Lange wurde gestritten.', url: 'https://www.sr.de/x' }]);
  for (const bad of [null, 'oops', {}, { news: 'x' }]) assert.deepEqual(parseTagesschau(bad), []);
  const xml = `<rss><channel><item><title><![CDATA[Prozess in Hamburg]]></title><description>&lt;p&gt;Es geht um &quot;Anschlag&quot; &amp; mehr&#8230;&lt;/p&gt;</description><link>https://www.ndr.de/a</link></item><item><title></title></item></channel></rss>`;
  assert.deepEqual(parseRss(xml), [{ title: 'Prozess in Hamburg', text: 'Es geht um "Anschlag" & mehr…', url: 'https://www.ndr.de/a' }]);
  for (const bad of ['<html><body>502 Bad Gateway</body></html>', '', null, '<item><title>&#99999999;</title></item>']) assert.ok(Array.isArray(parseRss(bad)));
});

test('cefr3', () => {
  assert.deepEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', undefined].map(cefr3), ['B1', 'B1', 'B1', 'B2', 'C1', 'C1', null]);
});

test('pickCandidates: 덱·뺀 것·사실 없음·A1/A2·약어·기준 미달 제외, 뉴스 2회 이상 먼저', () => {
  const hits = new Map([['Vorfall|noun', { n: 3, url: 'https://b' }], ['Fremd|noun', { n: 5, url: null }]]);
  const out = pickCandidates({ index: INDEX, have: new Set(['haus|noun']), skips: new Set(), hits, max: 10 });
  assert.deepEqual(out.map((c) => c.key), ['Vorfall|noun', 'ermitteln|verb']);
  assert.deepEqual(out[0], { key: 'Vorfall|noun', lemma: 'Vorfall', pos: 'noun', rank: 30000, hits: 3, level: 'B1' });
  assert.equal(out[1].level, 'B2');
  assert.deepEqual(pickCandidates({ index: INDEX, have: new Set(), skips: new Set(['ermitteln|verb']), hits: new Map(), max: 10 }).map((c) => c.key), []);
});

test('acceptContent · acceptRequests: 모양이 틀린 줄은 버림', () => {
  const list = [{ key: 'A|noun' }, { key: 'B|noun' }, { key: 'C|noun' }];
  const got = acceptContent([
    { key: 'A|noun', keep: true, gloss_ko: '가', example_de: 'Das ist A.', example_ko: '이건 A예요.', scene_en: 'Borti holds A.' },
    { key: 'B|noun', keep: false, reason: '영화 말' },
    { key: 'C|noun', keep: true, gloss_ko: '다', example_de: 'x'.repeat(71), example_ko: '다', scene_en: 'Borti' },
    { key: 'Z|noun', keep: true },
  ], list);
  assert.deepEqual(got.map((x) => [x.key, x.keep]), [['A|noun', true], ['B|noun', false]]);
  const req = acceptRequests([
    { id: 1, keep: true, lemma: 'Ermittlung', pos: 'noun', gender: 'die', plural: 'Ermittlungen', level: 'B2', gloss_ko: '수사', example_de: 'Die Ermittlung läuft.', example_ko: '수사가 진행 중이에요.', scene_en: 'Borti with a magnifier.' },
    { id: 2, keep: true, lemma: 'https://x', pos: 'noun', gloss_ko: '?', example_de: 'x', example_ko: 'x', scene_en: 'Borti x' },
    { id: 3, keep: false, reason: '사람 이름' },
    { id: 4, keep: true, lemma: 'Haus', pos: 'thing', gloss_ko: '집', example_de: 'Haus.', example_ko: '집.', scene_en: 'Borti home' },
  ], [1, 2, 3]);
  assert.equal(req.get(1).lemma, 'Ermittlung');
  assert.equal(req.has(2), false);
  assert.deepEqual(req.get(3), { keep: false, reason: '사람 이름' });
  assert.equal(req.has(4), false, '모르는 id');
});

test('acceptVerdicts: 모르는·겹친 id, 틀린 타입, 모르는 칸은 버림 (Review Focus 1)', () => {
  const v = acceptVerdicts([
    { id: 'w1', ok: true },
    { id: 'w1', ok: false, fix: { gloss_ko: '두 번째는 무시' } },
    { id: 'w2', ok: false, fix: { gloss_ko: '이사', gender: 3, lemma: 'Hack', plural: null, level: 'B2' }, meaning_changed: 'yes', why: 'x'.repeat(300) },
    { id: 'w9', ok: false, fix: { gloss_ko: '?' } },
    { id: 'w3', ok: 'false' },
    'junk',
  ], ['w1', 'w2', 'w3']);
  assert.deepEqual([...v.keys()], ['w1', 'w2']);
  assert.deepEqual(v.get('w2'), { ok: false, fix: { gloss_ko: '이사', plural: null, level: 'B2' }, meaning_changed: false, why: 'x'.repeat(200) });
  assert.deepEqual(acceptVerdicts(null, ['w1']), new Map());
});

const W = (o = {}) => ({ id: 'w1', lemma: 'Umzug', pos: 'noun', gender: 'der', plural: 'Umzüge', level: 'B1', gloss_ko: '이동', gloss_status: 'generated',
  example_de: 'Der Umzug war anstrengend.', example_ko: '이사는 힘들었어요.', checked_at: null, reverted: [], report: null, ...o });
const F = (o = {}) => ({ genders: ['der'], plural: 'Umzüge', daflexRaw: 'A2', daflex: 'B1', hasForm: (de) => /Umz/.test(de), ...o });

test('decide: 맞음 → 바꿀 것 없음, 신고된 카드면 확인 필요 메모', () => {
  assert.deepEqual(decide(W(), F(), { ok: true }), { patch: {}, changes: [], meaningChanged: false });
  const r = decide(W({ report: { kind: 'example', note: '어색' } }), F(), { ok: true });
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].field, 'note');
  assert.equal(r.changes[0].applied, 0);
});

test('decide: 뜻 고침 · 뜻이 바뀌면 그림 다시 · mine·40자 넘음·되돌린 칸은 확인 필요 (Review Focus 2)', () => {
  const r = decide(W(), F(), { ok: false, fix: { gloss_ko: ' 이사 ' }, meaning_changed: true, why: '주된 뜻' });
  assert.deepEqual(r.patch, { gloss_ko: '이사' });
  assert.deepEqual(r.changes, [{ field: 'gloss_ko', old: '이동', new: '이사', why: '주된 뜻', applied: 1 }]);
  assert.equal(r.meaningChanged, true);
  for (const [w, reason] of [[W({ gloss_status: 'mine' }), '내가 쓴 뜻'], [W(), '형식'], [W(), '되돌린']]) {
    const gloss = reason === '형식' ? '가'.repeat(41) : '이사';
    const d = decide(w, F(), { ok: false, fix: { gloss_ko: gloss }, meaning_changed: true }, reason === '되돌린' ? new Set(['gloss_ko']) : new Set());
    assert.deepEqual(d.patch, {}, reason);
    assert.equal(d.changes[0].applied, 0);
    assert.match(d.changes[0].why, new RegExp(reason));
    assert.equal(d.meaningChanged, false);
  }
});

test('decide: 예문은 번역과 같이만 · 표제어 없는 예문 거절 · 번역만 고침', () => {
  const ok = decide(W(), F(), { ok: false, fix: { example_de: 'Der Umzug dauerte lange.', example_ko: '이사는 오래 걸렸어요.' } });
  assert.deepEqual(ok.patch, { example_de: 'Der Umzug dauerte lange.', example_ko: '이사는 오래 걸렸어요.' });
  assert.equal(decide(W(), F(), { ok: false, fix: { example_de: 'Der Umzug dauerte lange.' } }).changes[0].applied, 0);
  assert.match(decide(W(), F(), { ok: false, fix: { example_de: 'Das Wetter ist schön.', example_ko: '날씨가 좋아요.' } }).changes[0].why, /표제어/);
  assert.deepEqual(decide(W(), F(), { ok: false, fix: { example_ko: '이사는 정말 힘들었어요.' } }).patch, { example_ko: '이사는 정말 힘들었어요.' });
  // 독일어는 그대로, 번역만 다름
  assert.deepEqual(decide(W(), F(), { ok: false, fix: { example_de: 'Der Umzug war anstrengend.', example_ko: '이사는 고됐어요.' } }).patch, { example_ko: '이사는 고됐어요.' });
});

test('decide: 관사·복수는 위키낱말사전과 같을 때만, 레벨은 DAFlex 와 같을 때만, 근거 없으면 확인 필요', () => {
  assert.deepEqual(decide(W({ gender: 'die' }), F(), { ok: false, fix: { gender: 'der' } }).patch, { gender: 'der' });
  assert.equal(decide(W(), F(), { ok: false, fix: { gender: 'das' } }).changes[0].applied, 0);
  assert.equal(decide(W(), F({ genders: null }), { ok: false, fix: { gender: 'die' } }).changes[0].applied, 0);
  assert.equal(decide(W(), F(), { ok: false, fix: { gender: 'm' } }).changes[0].applied, 0);
  assert.deepEqual(decide(W({ plural: 'Umzugs' }), F(), { ok: false, fix: { plural: 'Umzüge' } }).patch, { plural: 'Umzüge' });
  assert.equal(decide(W(), F({ plural: undefined }), { ok: false, fix: { plural: 'Umzüger' } }).changes[0].applied, 0);
  assert.deepEqual(decide(W({ level: 'C1' }), F(), { ok: false, fix: { level: 'B1' } }).patch, { level: 'B1' });
  assert.equal(decide(W(), F(), { ok: false, fix: { level: 'C1' } }).changes[0].applied, 0);
  // 고칠 값이 없거나 지금 값과 같으면 메모만
  assert.equal(decide(W(), F(), { ok: false, fix: { gloss_ko: '이동' }, why: '애매' }).changes[0].field, 'note');
});

test('exampleHasWord · factsFor · reviewPrompt', () => {
  const w = { lemma: 'ermitteln', pos: 'verb' };
  assert.equal(exampleHasWord('Die Polizei ermittelt.', w, null), true, '어간');
  assert.equal(exampleHasWord('Ermittelte sie?', w, INDEX), true, '색인 활용형 + 첫 낱말');
  assert.equal(exampleHasWord('Sie rief gestern an.', { lemma: 'anrufen', pos: 'verb' }, INDEX), true, '분리동사');
  assert.equal(exampleHasWord('Das Wetter ist schön.', w, INDEX), false);
  const f = factsFor({ lemma: 'Umzug', pos: 'noun' }, INDEX);
  assert.deepEqual([f.genders, f.plural, f.daflexRaw, f.daflex], [['der'], 'Umzüge', 'A2', 'B1']);
  const none = factsFor({ lemma: 'Umzug', pos: 'noun' }, null);
  assert.deepEqual([none.genders, none.plural, none.daflex], [null, undefined, null]);
  const p = reviewPrompt([W({ report: { kind: 'meaning', note: null } })], (w2) => factsFor(w2, INDEX));
  assert.match(p, /"learner_report":\{"kind":"meaning"/);
  assert.match(p, /"wiktionary_plural":"Umzüge"/);
  assert.match(p, /exactly 1 objects/);
});
