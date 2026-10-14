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

// ---------- 2단계 ----------
import { restOf, morningTitle, eveningTitle, quiet, seedOf } from '../shared/copy.ts';
import { assertNoStats } from '../worker/discord.ts';
import { seenLabel } from '../src/format.ts';

test('A3 restOf: 어제 했으면 0 · 사흘 비면 3 · 휴가는 안 셈 · 돌아온 날', () => {
  assert.deepEqual(restOf([], '2026-10-15'), { rest: 0, returning: false });
  assert.deepEqual(restOf(['2026-10-15'], '2026-10-15'), { rest: 0, returning: false });
  assert.deepEqual(restOf(['2026-10-14'], '2026-10-15'), { rest: 0, returning: false });
  assert.equal(restOf(['2026-10-11'], '2026-10-15').rest, 3);
  assert.equal(restOf(['2026-10-01'], '2026-10-15', '2026-10-13').rest, 1, '휴가 끝(13일) 다음 날부터 셈');
  assert.deepEqual(restOf(['2026-10-14', '2026-10-09'], '2026-10-15'), { rest: 0, returning: true });
  assert.equal(restOf(['2026-10-14', '2026-10-12'], '2026-10-15').returning, false, '하루 쉰 건 반기지 않음');
});

test('A3 문구: 단계별 제목 · 4일부터 저녁 끔·아침 월요일만 · 금지어 없음(G14)', () => {
  const md = '10/15';
  const titles = [];
  for (const rest of [0, 1, 2, 3, 4]) for (const seed of [0, 1]) {
    titles.push(morningTitle({ n: 5, md, rest, returning: false, seed }));
    titles.push(eveningTitle({ n: 6, rest, studiedToday: false, seed }));
  }
  titles.push(morningTitle({ n: 5, md, rest: 0, returning: true, seed: 0 }), eveningTitle({ n: 6, rest: 0, studiedToday: true, seed: 0 }));
  for (const t of titles) assert.doesNotThrow(() => assertNoStats(t), t);
  assert.equal(morningTitle({ n: 5, md, rest: 0, returning: false, seed: 0 }), '오늘 카드 5 · 10/15');
  assert.equal(morningTitle({ n: 5, md, rest: 3, returning: false, seed: 0 }), '오늘이 마지막으로 조르는 날이에요 · 10/15');
  assert.equal(eveningTitle({ n: 6, rest: 0, studiedToday: true, seed: 0 }), '카드 6장 남았어요');
  assert.equal(quiet('evening', 3, '2026-10-15'), false);
  assert.equal(quiet('evening', 4, '2026-10-15'), true);
  assert.equal(quiet('morning', 4, '2026-10-15'), true, '목요일');
  assert.equal(quiet('morning', 9, '2026-10-19'), false, '월요일은 보냄');
  assert.equal(seedOf('2026-10-15'), 20261015);
});

test('B2 seenLabel: 새 단어 · 다시 익히는 중 · 오늘 또 · 어제 · N일 · N개월', () => {
  const now = new Date('2026-10-15T03:00:00Z'); // 12:00 KST
  const c = (state, last) => ({ state, last_review: last });
  assert.deepEqual(seenLabel(c(0, null), now), { text: '새 단어', tone: 'new' });
  assert.equal(seenLabel(c(3, '2026-10-14T00:00:00Z'), now).text, '다시 익히는 중');
  assert.equal(seenLabel(c(2, '2026-10-15T00:30:00Z'), now).text, '오늘 또');
  assert.equal(seenLabel(c(2, '2026-10-14T03:00:00Z'), now).text, '어제 본 단어');
  assert.deepEqual(seenLabel(c(2, '2026-10-03T03:00:00Z'), now), { text: '12일 만에 다시', tone: 'again' });
  assert.equal(seenLabel(c(2, '2026-08-01T03:00:00Z'), now).text, '2개월 만에 다시');
});

// ---------- 3단계 ----------
import { initDeck, deckReducer, shuffle } from '../src/deck.ts';

test('B4 추가 연습 줄: 다시·어려움은 뒤로(최대 2번), 좋음·쉬움은 빼기 · 오늘 덱은 다시만 뒤로', () => {
  const q = ['a', 'b'].map((id) => ({ word: { id }, card: {} }));
  let s = initDeck(q, 2);
  s = deckReducer(s, { type: 'grade', rating: 2, at: '1' }); // a 어려움 → 뒤로
  assert.equal(s.queue.length, 3);
  s = deckReducer(s, { type: 'grade', rating: 3, at: '2' }); // b 좋음 → 빼기
  s = deckReducer(s, { type: 'grade', rating: 4, at: '3' }); // a 쉬움
  assert.equal(s.finished, true);
  let t = initDeck(q); // 오늘 덱 기본 = 다시(1)만
  t = deckReducer(t, { type: 'grade', rating: 2, at: '1' });
  assert.equal(t.queue.length, 2, '어려움은 오늘 덱에서 다시 안 나온다');
});

test('shuffle: 원소 그대로, 원본 안 건드림', () => {
  const a = [1, 2, 3, 4, 5];
  let k = 0;
  const r = shuffle(a, () => [0.1, 0.9, 0.5, 0.3][k++ % 4]);
  assert.deepEqual([...r].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(a, [1, 2, 3, 4, 5]);
});

// ---------- 검토 반영 ----------
import { alarmDue } from '../worker/time.ts';

test('검토 1: 남은(늦은) 미룬 값이 있어도 아침 칸은 돈다 · 미룬 통만 버림', () => {
  const slot = Date.parse('2026-10-15T22:30:00Z');
  const staleLater = Date.parse('2026-10-15T13:00:00Z');
  assert.deepEqual(alarmDue(slot, slot, staleLater), { later: true, laterStale: true, slot: true });
  // 미룬 시각에 울림: 칸은 아직
  const later = Date.parse('2026-10-15T13:00:00Z');
  assert.deepEqual(alarmDue(later, slot, later), { later: true, laterStale: false, slot: false });
  // 예전 상태(slot_at 없음): 미룬 통이 아니면 칸
  assert.equal(alarmDue(slot, undefined, undefined).slot, true);
  assert.equal(alarmDue(later, undefined, later).slot, false);
});

test('검토 2·10: 금지어 든 뜻 · 같은 어간이 남는 예문은 빈칸 후보에서 빠진다 · 빈 글도 받은편지함이 안 죽는다', () => {
  const soap = it('w8343', 'Seifenoper', 'Sie schaut jeden Abend eine Seifenoper.', '연속극, 막장 드라마');
  const citizen = it('w9', 'Bürgerin', 'Die Bürgerin und der Bürger wählen.', '시민');
  const ok = it('w5', 'Umzug', 'Der Umzug nach Hamburg war anstrengend.', '이사');
  assert.equal(pickCloze([soap, citizen, ok]).id, 'w5');
  assert.equal(pickCloze([soap, citizen]), null);
  assert.deepEqual(summarize({}), { title: '', body: '', image: null, link: null });
  assert.deepEqual(summarize(JSON.parse('{}')).title, '');
});
