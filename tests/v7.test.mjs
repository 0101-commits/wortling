// v7 1단계 규칙: 학습일 04시(B1) · 아침 빈칸 문제(A1, G11) · 저녁 3조건(A2, G12) · 1시간 뒤 · 첫 카드 당기기.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studyDay, studyDayStartUtc, nextAlarm } from '../worker/time.ts';
import { findWord, clozeOf, BLANK } from '../shared/cloze.ts';
import { pickCloze, eveningSkip, laterAllowed } from '../worker/notify.ts';
import { morningPayload, summarize, todayLink } from '../worker/discord.ts';
import { pushMessage } from '../worker/push.ts';
import { firstUp } from '../src/deck.ts';
import { studyDay as clientStudyDay, dayDiff } from '../src/format.ts';

test('G13 학습일: 03:59 KST 는 전날, 04:00 은 그날', () => {
  // 2026-10-15 03:59 KST = 10-14 18:59Z
  assert.equal(studyDay(new Date('2026-10-14T18:59:00Z')), '2026-10-14');
  assert.equal(studyDay(new Date('2026-10-14T19:00:00Z')), '2026-10-15');
  assert.equal(studyDayStartUtc('2026-10-15'), '2026-10-14T19:00:00.000Z');
  // 앱 쪽 계산도 같다
  assert.equal(clientStudyDay(new Date('2026-10-14T18:59:00Z')), '2026-10-14');
  assert.equal(clientStudyDay(new Date('2026-10-14T19:00:00Z')), '2026-10-15');
  // 밤 1시에 만기된 카드는 「오늘」(같은 학습일)
  assert.equal(dayDiff('2026-10-14T16:00:00Z', new Date('2026-10-14T12:00:00Z')), 0);
});

test('findWord: 정확 · 합성어 앞부분 · 동사 어간 · sich · 못 찾음', () => {
  const de = 'Der Umzug nach Hamburg war anstrengend.';
  assert.deepEqual(findWord(de, 'Umzug'), [4, 9]);
  assert.equal(clozeOf(de, 'Umzug'), `Der ${BLANK} nach Hamburg war anstrengend.`);
  assert.equal(clozeOf('Er hat sich über das Essen beschwert.', 'sich beschweren'), `Er hat sich über das Essen ${BLANK}.`);
  assert.equal(clozeOf('Sie ist eine zuverlässige Kollegin.', 'zuverlässig'), `Sie ist eine ${BLANK} Kollegin.`);
  assert.equal(clozeOf('Wir packen die Umzugskartons.', 'Umzug'), `Wir packen die ${BLANK}.`);
  assert.equal(findWord('Das ist schön.', 'Haus'), null);
  assert.equal(findWord('Er ging nach Hause.', 'gehen'), null, '어간이 4자 미만이면 찾지 않는다');
});

const it = (id, lemma, example_de, gloss_ko = '뜻', image = false) => ({
  word: { id, lemma, pos: 'noun', gender: 'der', plural: null, ipa: null, level: 'B1', gloss_en: null, gloss_ko, example_de, example_ko: null, image, seq: 1 },
  card: { word_id: id, state: 2, due: '2026-10-15T00:00:00Z', stability: 3, difficulty: 5, elapsed_days: 1, scheduled_days: 3, learning_steps: 0, reps: 2, lapses: 0, last_review: '2026-10-12T00:00:00Z', introduced_at: null, suspended: 0 },
});

test('G11 pickCloze: 예문 없음·못 찾음·같은 단어 두 번·너무 긴 예문은 건너뛰고, 본문에 정답 글자가 없다', () => {
  const items = [
    it('w1', 'Hund', null),
    it('w2', 'Katze', 'Ich habe keinen Hund.'),
    it('w3', 'Ball', 'Der Ball und noch ein Ball.'),
    it('w4', 'Tisch', 'X'.repeat(120) + ' Tisch'),
    it('w5', 'Umzug', 'Der Umzug nach Hamburg war anstrengend.', '이사'),
  ];
  const c = pickCloze(items);
  assert.equal(c.id, 'w5');
  assert.equal(c.hint, '이사');
  assert.ok(!c.line.toLowerCase().includes('umzug'));
  assert.equal(pickCloze(items.slice(0, 4)), null);
});

test('A1 morningPayload: 빈칸 줄 + 힌트 + 「답 보고 시작」 → 첫 카드·알림 번호 링크', () => {
  const items = [it('w5', 'Umzug', 'Der Umzug nach Hamburg war anstrengend.', '이사'), it('w6', 'Ball', null)];
  const cloze = pickCloze(items);
  const p = morningPayload({ day: '2026-10-15', items, total: 5, appUrl: 'https://w', imageUrl: null, cloze, n: 12 });
  const { title, body, link } = summarize(p);
  assert.equal(title, '오늘 카드 5 · 10/15');
  assert.equal(body, `Der ${BLANK} nach Hamburg war anstrengend. (이사)\n답은 첫 카드에서 · 나머지 4장`);
  assert.equal(link, 'https://w/#/today?first=w5&n=12');
  assert.ok(!/Umzug/.test(JSON.stringify(p)), '정답 단어가 글 어디에도 없다');
  // 빈칸을 못 만든 날: 뜻 없이 표제어만
  const q = morningPayload({ day: '2026-10-15', items: [it('w6', 'Ball', null)], total: 1, appUrl: 'https://w', imageUrl: null, cloze: null });
  assert.equal(summarize(q).body, 'der Ball');
  assert.equal(todayLink('https://w'), 'https://w/#/today');
});

test('G12 eveningSkip: 기본(오늘 0장일 때만) · 남은 카드 최소 · 아침 안 간 날', () => {
  const base = { remaining: 6, reviewedToday: 0, morningSent: true, mode: 'none_today', min: 1 };
  assert.equal(eveningSkip(base), null);
  assert.equal(eveningSkip({ ...base, reviewedToday: 1 }), 'studied_today');
  assert.equal(eveningSkip({ ...base, reviewedToday: 20, mode: 'any_left' }), null, '종전 방식');
  assert.equal(eveningSkip({ ...base, remaining: 2, min: 3 }), 'none_due');
  assert.equal(eveningSkip({ ...base, remaining: 0 }), 'none_due');
  assert.equal(eveningSkip({ ...base, morningSent: false }), 'morning_not_sent');
});

test('1시간 뒤: 21:00·22:29 KST 는 됨, 22:31 은 안 됨(23:30 넘김) · 알람은 이른 쪽', () => {
  assert.equal(laterAllowed(new Date('2026-10-15T12:00:00Z')), true); // 21:00 KST
  assert.equal(laterAllowed(new Date('2026-10-15T13:29:00Z')), true); // 22:29
  assert.equal(laterAllowed(new Date('2026-10-15T13:31:00Z')), false); // 22:31 → 23:31
  assert.equal(nextAlarm(1000, undefined), 1000);
  assert.equal(nextAlarm(1000, 500), 500);
  assert.equal(nextAlarm(1000, 2000), 1000);
});

test('pushMessage: 저녁만 「지금 하기 · 1시간 뒤」와 행 열쇠', () => {
  const s = { title: '카드 6장 남았어요', body: 'b', image: null, link: 'https://w/#/today?n=3' };
  const e = pushMessage(s, 'evening', 'https://w', { nid: 3, key: 'k' });
  assert.deepEqual(e.actions.map((a) => a.action), ['open', 'later']);
  assert.equal(e.nid, 3);
  assert.equal(e.key, 'k');
  assert.equal(pushMessage(s, 'morning', 'https://w', { nid: 3, key: 'k' }).actions, undefined);
  assert.equal(pushMessage(s, 'evening_later', 'https://w', { nid: 4, key: 'k' }).actions, undefined, '미룬 통은 한 번 더 못 미룸');
});

test('firstUp: 정답 카드를 맨 앞으로, 없으면 그대로', () => {
  const q = ['a', 'b', 'c'].map((id) => ({ word: { id } }));
  assert.deepEqual(firstUp(q, 'c').map((x) => x.word.id), ['c', 'a', 'b']);
  assert.equal(firstUp(q, 'z'), q);
  assert.equal(firstUp(q, null), q);
  assert.equal(firstUp(q, 'a'), q);
});
