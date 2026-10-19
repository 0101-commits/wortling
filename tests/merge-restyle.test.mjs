// restyle.json 3-방향 합치기(daily.yml 되올리기) — 실행이 지운 것은 되살리지 않고, main 에서 새로 넣은 것은 살린다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeRestyle } from '../scripts/merge-restyle.mjs'

test('실행이 다시 그려 뺀 id 는 되살리지 않는다', () => {
  assert.deepEqual(mergeRestyle(['a', 'b', 'c'], ['a', 'b', 'c'], ['b', 'c']), ['b', 'c'])
})

test('도는 사이 main 에 손으로 넣은 id 는 앞에 살린다', () => {
  assert.deepEqual(mergeRestyle(['a', 'b'], ['x', 'y', 'a', 'b'], ['b', 'z']), ['x', 'y', 'b', 'z'])
})

test('main 에서 손으로 뺀 id 는 실행 쪽에서도 뺀다 · 겹치면 한 번만', () => {
  assert.deepEqual(mergeRestyle(['a', 'b'], ['b', 'x'], ['a', 'b', 'x']), ['x', 'b'])
})
