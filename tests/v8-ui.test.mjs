// 기획 v8 화면 쪽: 오늘 덱의 같은 판 다시 보기(F2) · 더 공부하기 문제 만들기(과제 4)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deckReducer, initDeck, nextCard } from '../src/deck.ts'
import { applyRating } from '../worker/fsrs.ts'
import { MATCH_SIZE, clozeParts, distractors, makeMatches, makeQuestion, makeQuestions } from '../src/practice.ts'

const AT = Date.parse('2026-10-26T03:00:00Z')
const DAY_END = '2026-10-26T19:00:00.000Z'
const card = (id, state = 0, extra = {}) => ({
  word_id: id, state, due: '2026-10-26T00:00:00.000Z', stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0,
  learning_steps: 0, reps: 0, lapses: 0, last_review: null, introduced_at: null, suspended: 0, ...extra,
})
const item = (id, state = 0, extra) => ({ word: { id, lemma: `Wort${id}` }, card: card(id, state, extra) })

test('nextCard = 서버 applyRating 과 같은 결과(간격 글자·다시 보기 판단이 서버와 어긋나지 않게)', () => {
  let c = card('w1')
  let t = AT
  for (const r of [3, 3, 1, 3, 4]) {
    const at = new Date((t += 60_000))
    const mine = nextCard(c, r, at)
    const { nextRow } = applyRating(c, r, at)
    assert.deepEqual(mine, nextRow)
    c = mine
  }
})

test('F2: 오늘 덱 — 새 카드 「좋음」은 10분 뒤라 같은 판 뒤로, 두 번째 「좋음」이면 끝(판이 끝나면 오늘 할 카드 없음)', () => {
  let s = initDeck([item('a'), item('b')], 1, DAY_END)
  let t = AT
  const grade = (rating) => (s = deckReducer(s, { type: 'grade', rating, at: new Date((t += 5000)).toISOString() }))
  grade(3) // a → 10분 뒤 → 뒤로
  grade(4) // b 쉬움 → 8일 → 끝
  assert.deepEqual(s.queue.map((x) => x.word.id), ['a', 'b', 'a'])
  assert.equal(s.queue[2].card.state, 1, '다시 나온 카드는 채점 뒤 상태(간격 글자가 맞게)')
  grade(3) // a 두 번째 좋음 → 며칠 뒤
  assert.equal(s.finished, true)
  assert.equal(s.pending.length, 3)
})

test('F2: 다시만 누르면 같은 판에서 최대 3번 더, 그 뒤는 오늘 몫에 남는다 · 내일 마감 복습은 뒤로 안 감', () => {
  let s = initDeck([item('a')], 1, DAY_END)
  let t = AT
  for (let k = 0; k < 4; k++) s = deckReducer(s, { type: 'grade', rating: 1, at: new Date((t += 5000)).toISOString() })
  assert.equal(s.finished, true)
  assert.equal(s.pending.length, 4)
  // 복습 카드 좋음 → 며칠 뒤 → 뒤로 안 감
  const rev = item('r', 2, { stability: 10, difficulty: 5, reps: 5, scheduled_days: 10, last_review: '2026-10-16T03:00:00.000Z', due: '2026-10-26T01:00:00.000Z' })
  let s2 = initDeck([rev], 1, DAY_END)
  s2 = deckReducer(s2, { type: 'grade', rating: 3, at: new Date(AT).toISOString() })
  assert.equal(s2.finished, true)
})

test('추가 연습(dayEnd 없음)은 예전 규칙 그대로: 다시·어려움만 뒤로', () => {
  let s = initDeck([item('a'), item('b')], 2)
  s = deckReducer(s, { type: 'grade', rating: 3, at: new Date(AT).toISOString() })
  s = deckReducer(s, { type: 'grade', rating: 2, at: new Date(AT + 1000).toISOString() })
  assert.deepEqual(s.queue.map((x) => x.word.id), ['a', 'b', 'b'])
})

// ── 문제 만들기 ──
const W = (id, lemma, pos, gloss_ko, example_de = null, gender = null) => ({
  word: { id, lemma, pos, gender, gloss_ko, example_de, example_ko: '번역', level: 'B1', image: false, seq: 1, plural: null, ipa: null, gloss_en: null },
  card: card(id, 2),
})
const pool = [
  { id: 'v1', lemma: 'unterstützen', pos: 'verb', gender: null, gloss_ko: '지원하다, 돕다' },
  { id: 'v2', lemma: 'erkennen', pos: 'verb', gender: null, gloss_ko: '알아보다' },
  { id: 'v3', lemma: 'übernehmen', pos: 'verb', gender: null, gloss_ko: '떠맡다' },
  { id: 'v4', lemma: 'hindern', pos: 'verb', gender: null, gloss_ko: '막다' }, // 정답과 뜻 조각이 겹침 → 빠져야
  { id: 'n1', lemma: 'Grenze', pos: 'noun', gender: 'die', gloss_ko: '국경, 경계' },
  { id: 'n2', lemma: 'Regel', pos: 'noun', gender: 'die', gloss_ko: '규칙' },
  { id: 'n3', lemma: 'Verletzung', pos: 'noun', gender: 'die', gloss_ko: '부상, 상처' },
  { id: 'n4', lemma: 'Gefahr', pos: 'noun', gender: 'die', gloss_ko: '위험' },
]
const rand = (() => {
  let x = 7
  return () => ((x = (x * 9301 + 49297) % 233280) / 233280)
})()

test('예문 빈칸: 실제 꼴을 빈칸으로 · 같은 어간이 남으면 못 씀 · 예문에 없으면 못 씀', () => {
  assert.deepEqual(clozeParts('Der Regen hat das Picknick verhindert.', 'verhindern'), { before: 'Der Regen hat das Picknick ', hit: 'verhindert', after: '.' })
  assert.equal(clozeParts('Die Grenze ist eine grenzenlose Sache.', 'Grenze'), null)
  assert.equal(clozeParts('Ich gebe nicht auf.', 'aufgeben'), null)
})

test('오답: 같은 품사 · 정답과 뜻 조각이 겹치는 단어 빼기 · 모자라면 null', () => {
  const v = W('v0', 'verhindern', 'verb', '막다, 방지하다', 'Der Regen hat das Picknick verhindert.')
  const d = distractors(v, pool, (p) => p.lemma, rand)
  assert.equal(d.length, 3)
  assert.ok(!d.some((c) => c.id === 'v4'), '「막다」가 겹치는 hindern 은 보기에서 빠짐')
  assert.ok(d.every((c) => ['v1', 'v2', 'v3'].includes(c.id)), '같은 품사(동사) 먼저')
  assert.equal(distractors(v, pool.slice(0, 1), (p) => p.lemma, rand), null)
})

test('문제 만들기: 빈칸 · 뜻 · 독일어 고르기, 정답 하나씩 · 보기마다 그 단어(답한 뒤 뜻 보여 주기)', () => {
  const v = W('v0', 'verhindern', 'verb', '막다, 방지하다', 'Der Regen hat das Picknick verhindert.')
  const cl = makeQuestion('cloze', v, pool, rand)
  assert.equal(cl.choices.length, 4)
  assert.equal(cl.choices.filter((c) => c.id === 'v0').length, 1)
  assert.equal(cl.choices.find((c) => c.id === 'v0').text, 'verhindern', '보기는 기본형')

  // 고른 오답의 뜻을 보여 주려고 보기마다 단어를 함께 든다
  assert.ok(cl.choices.every((c) => c.word && c.word.id === c.id && c.word.gloss_ko))

  const n = W('n0', 'Sicherheit', 'noun', '안전', 'Zur Sicherheit nehme ich einen Schirm mit.', 'die')

  const m = makeQuestion('meaning', n, pool, rand)
  assert.ok(m.choices.some((c) => c.text === '안전'))
  const mr = makeQuestion('meaning_rev', n, pool, rand)
  assert.ok(mr.choices.some((c) => c.text === 'die Sicherheit'), '독일어 고르기는 관사 붙임')
  assert.ok(mr.choices.every((c) => /^die /.test(c.text)))

  // 예문이 없거나 못 찾으면 문제에서 빠지고, 만들 수 있는 것만 n 개
  const none = W('x', 'aufgeben', 'verb', '포기하다', 'Ich gebe nicht auf.')
  assert.equal(makeQuestion('cloze', none, pool, rand), null)
  const qs = makeQuestions('cloze', [none, v, none], pool, 10, rand)
  assert.equal(qs.length, 1)
})

test('짝 맞추기: 단어 n 개를 고르게 판으로(7 → 4 + 3) · 한 판 안에 뜻 겹치는 단어 없음 · 양쪽 같은 id', () => {
  const items = [
    W('a1', 'Grenze', 'noun', '국경, 경계', null, 'die'),
    W('a2', 'Regel', 'noun', '규칙', null, 'die'),
    W('a3', 'verhindern', 'verb', '막다, 방지하다'),
    W('a4', 'hindern', 'verb', '막다'), // a3 과 뜻 겹침 → 다른 판
    W('a5', 'Gefahr', 'noun', '위험', null, 'die'),
    W('a6', 'erkennen', 'verb', '알아보다'),
    W('a7', 'übernehmen', 'verb', '떠맡다'),
    W('a8', 'leer', 'adj', null), // 뜻 없음 → 빠짐
  ]
  const qs = makeMatches(items, 10, rand)
  assert.deepEqual(qs.map((q) => q.items.length).sort(), [3, 4])
  for (const q of qs) {
    assert.ok(q.items.length <= MATCH_SIZE)
    assert.deepEqual(q.left.map((c) => c.id).sort(), q.right.map((c) => c.id).sort())
    const ids = q.items.map((it) => it.word.id)
    assert.ok(!(ids.includes('a3') && ids.includes('a4')), '뜻 조각 「막다」가 겹치는 둘은 같은 판에 안 넣는다')
  }
  assert.equal(qs.flatMap((q) => q.left).find((c) => c.id === 'a1').text, 'die Grenze', '왼쪽은 관사 붙인 독일어')
  assert.equal(qs.flatMap((q) => q.right).find((c) => c.id === 'a1').text, '국경, 경계')
  // 10 개 넘게 있으면 5 + 5, 3 개 미만이면 문제 없음
  const many = Array.from({ length: 14 }, (_, i) => W('m' + i, 'Wort' + i, 'noun', '뜻' + i, null, 'das'))
  assert.deepEqual(makeQuestions('match', many, [], 10, rand).map((q) => q.items.length), [5, 5])
  assert.deepEqual(makeMatches(items.slice(0, 2), 10, rand), [])
})
