// scripts/ai.mjs(Gemini) 검사 — fetch 를 바꿔 끼워 네트워크 없이. 키는 헤더로 · 그림은 inline_data · 퇴역(404)이면 다음 모델.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askJson } from '../scripts/ai.mjs'

const reply = (status, json) => ({ ok: status < 400, status, json: async () => json })
const answer = (text) => reply(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } })

test('키가 없으면 부르지 않고 던진다', async () => {
  delete process.env.GEMINI_API_KEY
  await assert.rejects(askJson('x'), /GEMINI_API_KEY/)
})

test('퇴역(404)이면 다음 모델 · 키는 헤더 · 그림은 #n 글 조각 + inline_data · 코드 울타리 벗김', async () => {
  process.env.GEMINI_API_KEY = 'k-test'
  const calls = []
  const orig = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return calls.length === 1 ? reply(404, { error: { message: 'model retired' } }) : answer('```json\n[{"n":1,"ok":true}]\n```')
  }
  try {
    assert.deepEqual(await askJson('판정', { images: [{ label: '#1', png: Buffer.from('PNG') }] }), [{ n: 1, ok: true }])
  } finally {
    globalThis.fetch = orig
  }
  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /gemini-flash-latest:generateContent$/)
  assert.match(calls[1].url, /gemini-flash-lite-latest:generateContent$/)
  assert.ok(!calls[1].url.includes('k-test'))
  assert.equal(calls[1].init.headers['x-goog-api-key'], 'k-test')
  const parts = JSON.parse(calls[1].init.body).contents[0].parts
  assert.equal(parts[0].text, '판정')
  assert.equal(parts[1].text, '#1')
  assert.deepEqual(parts[2], { inline_data: { mime_type: 'image/png', data: Buffer.from('PNG').toString('base64') } })
})

test('항목 하나가 {…} 로 와도 · {"items":[…]} 로 감싸 와도 배열로', async () => {
  process.env.GEMINI_API_KEY = 'k-test'
  const orig = globalThis.fetch
  try {
    globalThis.fetch = async () => answer('{"n":1,"ok":false,"why":"x"}')
    assert.deepEqual(await askJson('a'), [{ n: 1, ok: false, why: 'x' }])
    globalThis.fetch = async () => answer('{"items":[{"n":1},{"n":2}],"note":"x"}')
    assert.deepEqual(await askJson('b'), [{ n: 1 }, { n: 2 }])
    globalThis.fetch = async () => answer('{"id":"w1","ok":true,"issues":["a"]}')
    assert.deepEqual(await askJson('c'), [{ id: 'w1', ok: true, issues: ['a'] }])
  } finally {
    globalThis.fetch = orig
  }
})

test('{"error":…} · 잘린 응답(MAX_TOKENS)은 성공으로 치지 않는다', { timeout: 30000 }, async () => {
  process.env.GEMINI_API_KEY = 'k-test'
  const orig = globalThis.fetch
  let n = 0
  try {
    // 항목처럼 안 생긴 객체: 네 번(모델 둘 × 두 번) 다 실패 → 던짐
    globalThis.fetch = async () => (n++, reply(200, { candidates: [{ content: { parts: [{ text: '{"error":"cannot"}' }] }, finishReason: 'STOP' }] }))
    await assert.rejects(askJson('d'), /JSON 배열이 아님/)
    assert.equal(n, 4)
    globalThis.fetch = async () => reply(200, { candidates: [{ content: { parts: [{ text: '[{"n":1,"ok":true},{"n":2,"ok' }] }, finishReason: 'MAX_TOKENS' }] })
    await assert.rejects(askJson('e'), /MAX_TOKENS/)
  } finally {
    globalThis.fetch = orig
  }
})

test('하루 몫 소진(429 PerDay)이면 기다리지 않고 다음 모델', { timeout: 5000 }, async () => {
  process.env.GEMINI_API_KEY = 'k-test'
  const urls = []
  const orig = globalThis.fetch
  globalThis.fetch = async (url) => {
    urls.push(url)
    return urls.length === 1
      ? reply(429, { error: { message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } })
      : answer('[1]')
  }
  try {
    assert.deepEqual(await askJson('c'), [1])
  } finally {
    globalThis.fetch = orig
  }
  assert.equal(urls.length, 2)
  assert.match(urls[1], /flash-lite/)
})
