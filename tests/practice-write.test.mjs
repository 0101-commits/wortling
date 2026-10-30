// 독일어 쓰기 판정(src/practice.ts checkWrite): 관사 있이/없이 · 복수형 · 대소문자 · ae/oe/ue/ss · 공백
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkWrite } from '../src/practice.ts'

const item = (word) => ({ word: { id: 'w1', lemma: 'Hund', pos: 'noun', gender: 'der', plural: 'Hunde', ...word } })
const hund = item()

test('표제어 · 관사 붙인 꼴 · 대소문자 · 앞뒤 공백', () => {
  for (const s of ['Hund', 'der Hund', 'DER HUND', '  hund ', 'der   Hund']) assert.equal(checkWrite(hund, s), true, s)
})

test('복수형(데이터에 있을 때만)', () => {
  assert.equal(checkWrite(hund, 'Hunde'), true)
  assert.equal(checkWrite(hund, 'die Hunde'), true)
  assert.equal(checkWrite(item({ plural: null }), 'Hunde'), false)
  assert.equal(checkWrite(item({ plural: 'Hunde, Hünde' }), 'Hünde'), true)
})

test('관사가 틀리면 틀림', () => {
  assert.equal(checkWrite(hund, 'die Hund'), false)
  assert.equal(checkWrite(hund, 'das Hund'), false)
  assert.equal(checkWrite(hund, 'der Hunde'), false)
})

test('ä·ö·ü·ß 는 ae·oe·ue·ss 로 풀어 써도 맞음(정답 자리만)', () => {
  const b = item({ lemma: 'Bär', gender: 'der', plural: 'Bären' })
  for (const s of ['Bär', 'Baer', 'der Baer', 'Bären', 'Baeren']) assert.equal(checkWrite(b, s), true, s)
  assert.equal(checkWrite(item({ lemma: 'Straße', gender: 'die', plural: 'Straßen' }), 'die Strasse'), true)
  assert.equal(checkWrite(item({ lemma: 'schön', pos: 'adj', gender: null, plural: null }), 'schoen'), true)
})

test('관사 없는 품사 · sich 동사 · 다른 낱말 · 빈 입력', () => {
  const v = item({ lemma: 'sich freuen', pos: 'verb', gender: null, plural: null })
  assert.equal(checkWrite(v, 'freuen'), true)
  assert.equal(checkWrite(v, 'sich freuen'), true)
  assert.equal(checkWrite(hund, 'Katze'), false)
  assert.equal(checkWrite(hund, ''), false)
  assert.equal(checkWrite(hund, 'der'), false)
})

test('움라우트를 빼먹거나 정답에 없는 ae·ue 로 쓰면 틀림', () => {
  assert.equal(checkWrite(item({ lemma: 'Bär', gender: 'der', plural: 'Bären' }), 'Bar'), false)
  assert.equal(checkWrite(item({ lemma: 'Mutter', gender: 'die', plural: 'Mütter' }), 'Mutter'), true)
  assert.equal(checkWrite(item({ lemma: 'Mutter', gender: 'die', plural: 'Mütter' }), 'die Mutter'), true)
  assert.equal(checkWrite(item({ lemma: 'Mutter', gender: 'die', plural: 'Mütter' }), 'Mutter '), true)
  assert.equal(checkWrite(item({ lemma: 'schön', pos: 'adj', gender: null, plural: null }), 'schon'), false)
  for (const [lemma, s] of [['Feuer', 'Feur'], ['Mauer', 'Maur'], ['Steuer', 'Steur'], ['Quelle', 'Qulle']])
    assert.equal(checkWrite(item({ lemma, gender: 'das', plural: null }), s), false, s)
  assert.equal(checkWrite(item({ lemma: 'Feuer', gender: 'das', plural: null }), 'feuer'), true)
})
