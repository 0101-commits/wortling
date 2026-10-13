// 덱 세션 리듀서 검사(G4). Node 24 는 .ts 를 타입만 지우고 바로 읽는다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSession, decideSwipe, deckReducer, initDeck, intervalLabel, intervals } from '../src/deck.ts'

const card = (id, state = 0) => ({
  word_id: id, state, due: new Date().toISOString(), stability: state ? 5 : 0, difficulty: state ? 5 : 0,
  elapsed_days: 0, scheduled_days: state ? 5 : 0, learning_steps: 0, reps: state ? 3 : 0, lapses: 0,
  last_review: state ? new Date(Date.now() - 5 * 86_400_000).toISOString() : null, introduced_at: null, suspended: 0,
})
const item = (i, state = 0) => ({ word: { id: `w${i}`, lemma: `Wort${i}` }, card: card(`w${i}`, state) })
let clock = Date.parse('2026-10-13T03:00:00Z')
const at = () => new Date((clock += 1000)).toISOString()

test('G4: 17번 채점(다시 1번 포함) + 되돌리기 1번 → 보낼 채점 정확히 17개, 점수 그대로', () => {
  let s = initDeck(Array.from({ length: 16 }, (_, i) => item(i + 1, i % 2 ? 2 : 0)))
  const expected = []
  const grade = (rating) => {
    s = deckReducer(s, { type: 'grade', rating, at: at() })
    expected.push(rating)
  }
  grade(1) // 첫 카드 「다시」 → 맨 뒤에 다시 나온다
  assert.equal(s.queue.length, 17)
  for (let i = 0; i < 14; i++) grade([2, 3, 4][i % 3])
  // 실수로 쉬움 → 되돌리기 → 좋음
  s = deckReducer(s, { type: 'grade', rating: 4, at: at() })
  s = deckReducer(s, { type: 'undo' })
  assert.equal(s.index, 15)
  grade(3)
  assert.equal(s.queue[s.index].word.id, 'w1', '다시 나온 카드는 첫 카드')
  grade(3)
  assert.equal(s.finished, true)
  assert.equal(s.pending.length, 17)
  assert.deepEqual(s.pending.map((p) => p.rating), expected)
  assert.equal(new Set(s.pending.map((p) => p.reviewed_at)).size, 17, 'reviewed_at 은 모두 다르다')
})

test('되돌리기는 1단계만, 보낸 뒤에는 못 한다', () => {
  let s = initDeck([item(1), item(2), item(3)])
  s = deckReducer(s, { type: 'grade', rating: 3, at: at() })
  s = deckReducer(s, { type: 'grade', rating: 3, at: at() })
  s = deckReducer(s, { type: 'undo' })
  s = deckReducer(s, { type: 'undo' })
  assert.equal(s.index, 1)
  assert.equal(s.pending.length, 1)
  s = deckReducer(s, { type: 'grade', rating: 2, at: at() })
  s = deckReducer(s, { type: 'flush' })
  assert.equal(s.sentCount, 2)
  const before = s
  s = deckReducer(s, { type: 'undo' })
  assert.equal(s, before)
})

test('「다시」 카드는 한 세션에 최대 2번만 다시 나온다', () => {
  let s = initDeck([item(1)])
  for (let i = 0; i < 3; i++) s = deckReducer(s, { type: 'grade', rating: 1, at: at() })
  assert.equal(s.finished, true)
  assert.equal(s.pending.length, 3)
})

test('buildSession = 복습 + 새 단어, session_max 까지', () => {
  const today = { due: [item(1, 2), item(2, 2)], fresh: [item(3), item(4), item(5)], settings: { session_max: 4 } }
  assert.deepEqual(buildSession(today).map((x) => x.word.id), ['w1', 'w2', 'w3', 'w4'])
})

test('밀기 판정: 거리·속도·방향·2방향 모드', () => {
  assert.equal(decideSwipe(80, 0, 0, 0, 4), 3)
  assert.equal(decideSwipe(-80, 0, 0, 0, 4), 1)
  assert.equal(decideSwipe(79, 0, 0, 0, 4), null)
  assert.equal(decideSwipe(20, 0, 0.5, 0, 4), 3, '빠르게 튕기면 짧아도 확정')
  assert.equal(decideSwipe(20, 0, -0.5, 0, 4), null, '반대로 튕기면 취소')
  assert.equal(decideSwipe(10, -70, 0, 0, 4), 4)
  assert.equal(decideSwipe(10, 70, 0, 0, 4), 2)
  assert.equal(decideSwipe(60, 70, 0, 0, 4), null, '|y| > |x|×1.2 가 아니면 가로로 본다')
  assert.equal(decideSwipe(10, -90, 0, 0, 2), null, '2방향 모드는 세로 무시')
})

test('간격 글자', () => {
  assert.equal(intervalLabel(10 * 60_000), '10분')
  assert.equal(intervalLabel(5 * 3_600_000), '5시간')
  assert.equal(intervalLabel(8 * 86_400_000), '8일')
  const l = intervals(card('x', 0))
  assert.deepEqual(Object.keys(l), ['1', '2', '3', '4'])
  for (const v of Object.values(l)) assert.match(v, /^\d+(분|시간|일)$/)
})
