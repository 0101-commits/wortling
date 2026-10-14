// Worker 순수 함수 시험. Node 24 가 .ts 를 바로 읽는다(지울 수 있는 문법만).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kstDay, kstDayStartUtc, addDays, monthDay } from '../worker/time.ts';
import { applyRating } from '../worker/fsrs.ts';
import {
  morningPayload,
  eveningPayload,
  testPayload,
  minutesFor,
  countComponents,
  assertNoStats,
  summarize,
} from '../worker/discord.ts';

test('kstDay: 자정 경계(UTC 15:00 = KST 0시)', () => {
  assert.equal(kstDay(new Date('2026-10-12T14:59:59Z')), '2026-10-12');
  assert.equal(kstDay(new Date('2026-10-12T15:00:00Z')), '2026-10-13');
  assert.equal(kstDayStartUtc('2026-10-13'), '2026-10-12T15:00:00.000Z');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(monthDay('2026-10-03'), '10/3');
});

const newCard = () => ({
  word_id: 'w0001',
  state: 0,
  due: '2026-10-01T00:00:00.000Z',
  stability: 0,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  last_review: null,
  introduced_at: null,
  suspended: 0,
});

test('applyRating: Good 네 번이면 간격이 늘어난다, Again 이면 다시 배움', () => {
  let row = newCard();
  let now = new Date('2026-10-01T00:00:00Z');
  const days = [];
  for (let i = 0; i < 4; i++) {
    const { nextRow } = applyRating(row, 3, now);
    days.push(nextRow.scheduled_days);
    row = nextRow;
    now = new Date(row.due); // 다음 채점은 정확히 예정일에
  }
  for (let i = 1; i < days.length; i++) assert.ok(days[i] >= days[i - 1], `간격 ${days}`);
  assert.ok(days[3] > days[0], `간격이 늘어야 함 ${days}`);
  assert.equal(row.state, 2, 'Review 상태');
  assert.equal(row.reps, 4);
  assert.ok(row.introduced_at, '첫 채점 시각 도장');
  assert.equal(row.introduced_at, '2026-10-01T00:00:00.000Z');

  const { nextRow: again } = applyRating(row, 1, now);
  assert.equal(again.state, 3, 'Again → Relearning');
  assert.equal(again.lapses, 1);
  assert.ok(again.scheduled_days <= row.scheduled_days);
});

test('applyRating: 8번 잊으면 suspended', () => {
  let row = { ...newCard(), state: 2, stability: 10, difficulty: 5, reps: 10, lapses: 7, last_review: '2026-09-01T00:00:00.000Z' };
  const { nextRow } = applyRating(row, 1, new Date('2026-10-01T00:00:00Z'));
  assert.equal(nextRow.lapses, 8);
  assert.equal(nextRow.suspended, 1);
});

const item = (id, lemma, gender, gloss_ko) => ({
  word: { id, lemma, pos: 'noun', gender, plural: null, ipa: null, level: 'B1', gloss_en: null, gloss_ko, example_de: null, example_ko: null, image: id === 'w0001', seq: 1 },
  card: newCard(),
});

test('morningPayload: 40개 이하, 버튼 주소, 금지어 없음, 5단어 2줄씩', () => {
  const items = [item('w0001', 'Hund', 'der', '개'), item('w0002', 'Katze', 'die', '고양이'), item('w0003', 'Haus', 'das', '집'), item('w0004', 'gehen', null, '가다'), item('w0005', 'schön', null, '예쁜'), item('w0006', 'extra', null, '덤')];
  const p = morningPayload({ day: '2026-10-13', items, total: 23, appUrl: 'https://wortling.example', imageUrl: 'https://wortling.example/img/w0001.webp' });
  assert.equal(p.flags, 32768);
  assert.ok(countComponents(p) <= 40);
  assert.equal(countComponents(p), 6); // 컨테이너 + 갤러리 + 글 + 선 + 줄 + 단추
  const s = JSON.stringify(p);
  assert.ok(s.includes('https://wortling.example/#/today'));
  assert.ok(!/연속|정답률|외운/.test(s));
  const { title, body, image, link } = summarize(p);
  assert.equal(title, '오늘 카드 23 · 10/13');
  assert.equal(body, 'der Hund · die Katze · das Haus\ngehen · schön');
  assert.equal(image, 'https://wortling.example/img/w0001.webp');
  assert.equal(link, 'https://wortling.example/#/today');
  assert.ok(!s.includes('extra'), '6번째 단어는 빠진다');
  assert.ok(!s.includes('고양이'), '빈칸을 못 만든 날에도 뜻은 안 보인다(A1)');

  const noImg = morningPayload({ day: '2026-10-13', items, total: 3, appUrl: 'https://x', imageUrl: null });
  assert.equal(countComponents(noImg), 5);
  assert.equal(summarize(noImg).image, null);
});

test('eveningPayload·minutesFor·testPayload', () => {
  assert.equal(minutesFor(0), 1);
  assert.equal(minutesFor(10), 1);
  assert.equal(minutesFor(11), 2);
  assert.equal(minutesFor(25), 3);
  const p = eveningPayload({ remaining: 12, minutes: minutesFor(12), appUrl: 'https://x' });
  const { title, body, link } = summarize(p);
  assert.equal(title, '카드 12장 남았어요');
  assert.equal(body, '약 2분이면 끝나요. 내일로 넘기면 복습이 쌓여요.');
  assert.equal(link, 'https://x/#/today');
  assert.equal(countComponents(p), 5);
  assert.equal(summarize(testPayload()).title, 'Wortling 연결됐어요');
});

test('assertNoStats 는 통계 표현을 막는다', () => {
  assert.throws(() => assertNoStats('3일 연속!'));
  assert.throws(() => assertNoStats('정답률 90%'));
  assert.throws(() => assertNoStats('외운 단어 10개'));
  assert.doesNotThrow(() => assertNoStats('카드 3장 남았어요'));
});

test('nextSlot: 아침 22:30Z · 저녁 12:00Z 를 차례로 고른다', async () => {
  const { nextSlot } = await import('../worker/time.ts');
  const a = nextSlot(new Date('2026-10-13T09:00:00Z'));
  assert.equal(a.kind, 'evening');
  assert.equal(a.at.toISOString(), '2026-10-13T12:00:00.000Z');
  const b = nextSlot(new Date('2026-10-13T12:00:00Z')); // 같은 시각은 지난 것으로 본다
  assert.equal(b.kind, 'morning');
  assert.equal(b.at.toISOString(), '2026-10-13T22:30:00.000Z');
  const c = nextSlot(new Date('2026-10-13T23:00:00Z'));
  assert.equal(c.kind, 'evening');
  assert.equal(c.at.toISOString(), '2026-10-14T12:00:00.000Z');
});

test('WEBHOOK_RE: 디스코드 웹훅만 받는다', async () => {
  const { WEBHOOK_RE } = await import('../worker/notify.ts');
  assert.ok(WEBHOOK_RE.test('https://discord.com/api/webhooks/123456789/abc_DEF-123'));
  assert.ok(WEBHOOK_RE.test('https://discordapp.com/api/webhooks/1/x'));
  assert.ok(!WEBHOOK_RE.test('https://evil.com/api/webhooks/1/x'));
  assert.ok(!WEBHOOK_RE.test('https://discord.com/api/webhooks/1/x?wait=true'));
  assert.ok(!WEBHOOK_RE.test('http://discord.com/api/webhooks/1/x'));
});
