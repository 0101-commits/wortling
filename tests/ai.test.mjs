// scripts/ai.mjs(Gemini) 검사 — fetch 를 바꿔 끼워 네트워크 없이. 키는 헤더로 · 그림은 inline_data · 퇴역(404)이면 다음 모델.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.AI_RETRY_MS = '0' // 다시 묻기 기다림 없이(모듈을 읽을 때 정해지므로 import 보다 먼저)
const { askJson, TEXT_MODELS, VISION_MODELS } = await import('../scripts/ai.mjs')

const reply = (status, json) => ({ ok: status < 400, status, json: async () => json })
const answer = (text) => reply(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } })

async function withFetch(fake, fn) {
  const orig = globalThis.fetch
  globalThis.fetch = fake
  try {
    return await fn()
  } finally {
    globalThis.fetch = orig
  }
}

test('키가 없으면 부르지 않고 던진다', async () => {
  delete process.env.GEMINI_API_KEY
  await assert.rejects(askJson('x'), /GEMINI_API_KEY/)
})

test('글 일은 Flash-Lite, 그림 검사는 Flash 만 — 무료 몫 나누기', async () => {
  process.env.GEMINI_API_KEY = 'k-test'
  assert.deepEqual(TEXT_MODELS, ['gemini-flash-lite-latest'])
  assert.deepEqual(VISION_MODELS, ['gemini-flash-latest'])
  const urls = []
  await withFetch(async (url) => (urls.push(url), answer('[1]')), () => askJson('a'))
  assert.match(urls[0], /gemini-flash-lite-latest:generateContent$/)
})

test('퇴역(404)이면 다음 모델 · 키는 헤더 · 그림은 #n 글 조각 + inline_data · 코드 울타리 벗김', async () => {
  process.env.GEMINI_API_KEY = 'k-test'
  const calls = []
  const got = await withFetch(
    async (url, init) => (calls.push({ url, init }), calls.length === 1 ? reply(404, { error: { message: 'model retired' } }) : answer('```json\n[{"n":1,"ok":true}]\n```')),
    () => askJson('판정', { images: [{ label: '#1', png: Buffer.from('PNG') }], models: ['m-a', 'm-b'] }),
  )
  assert.deepEqual(got, [{ n: 1, ok: true }])
  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /m-a:generateContent$/)
  assert.match(calls[1].url, /m-b:generateContent$/)
  assert.ok(!calls[1].url.includes('k-test'))
  assert.equal(calls[1].init.headers['x-goog-api-key'], 'k-test')
  const parts = JSON.parse(calls[1].init.body).contents[0].parts
  assert.equal(parts[0].text, '판정')
  assert.equal(parts[1].text, '#1')
  assert.deepEqual(parts[2], { inline_data: { mime_type: 'image/png', data: Buffer.from('PNG').toString('base64') } })
})

test('항목 하나가 {…} 로 와도 · {"items":[…]} 로 감싸 와도 배열로', async () => {
  process.env.GEMINI_API_KEY = 'k-test'
  assert.deepEqual(await withFetch(async () => answer('{"n":1,"ok":false,"why":"x"}'), () => askJson('a')), [{ n: 1, ok: false, why: 'x' }])
  assert.deepEqual(await withFetch(async () => answer('{"items":[{"n":1},{"n":2}],"note":"x"}'), () => askJson('b')), [{ n: 1 }, { n: 2 }])
  assert.deepEqual(await withFetch(async () => answer('{"id":"w1","ok":true,"issues":["a"]}'), () => askJson('c')), [{ id: 'w1', ok: true, issues: ['a'] }])
})

test('{"error":…} · 잘린 응답(MAX_TOKENS)은 성공으로 치지 않는다 · 모델마다 세 번', async () => {
  process.env.GEMINI_API_KEY = 'k-test'
  let n = 0
  const bad = async () => (n++, reply(200, { candidates: [{ content: { parts: [{ text: '{"error":"cannot"}' }] }, finishReason: 'STOP' }] }))
  await assert.rejects(withFetch(bad, () => askJson('d', { models: ['m-a', 'm-b'] })), /JSON 배열이 아님/)
  assert.equal(n, 6)
  const cut = async () => reply(200, { candidates: [{ content: { parts: [{ text: '[{"n":1,"ok":true},{"n":2,"ok' }] }, finishReason: 'MAX_TOKENS' }] })
  await assert.rejects(withFetch(cut, () => askJson('e')), /MAX_TOKENS/)
})

test('하루 몫 소진(429 PerDay)이면 기다리지 않고 다음 모델 · 오류에 quotaId', async () => {
  process.env.GEMINI_API_KEY = 'k-test'
  const urls = []
  const perDay = { error: { message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }
  const got = await withFetch(async (url) => (urls.push(url), urls.length === 1 ? reply(429, perDay) : answer('[1]')), () => askJson('c', { models: ['m-a', 'm-b'] }))
  assert.deepEqual(got, [1])
  assert.equal(urls.length, 2)
  await assert.rejects(withFetch(async () => reply(429, perDay), () => askJson('d', { models: ['m-a'] })), /429 \[GenerateRequestsPerDayPerProjectPerModel-FreeTier\]/)
})
