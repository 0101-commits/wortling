// scripts/judge.mjs — Gemini 가 오류 없이 빈 답을 주면 실패로 보고 Groq 폴백으로. fetch 를 바꿔 끼워 네트워크 없이.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'

process.env.AI_RETRY_MS = '0'
process.env.GEMINI_API_KEY = 'k-g'
process.env.GROQ_API_KEY = 'k-q'
const { judgeImages } = await import('../scripts/judge.mjs')

const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer()
const items = [{ id: 'w1', word: 'Hund', meaning_ko: '개', png }]
const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
const gemini = (text) => json(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: {} })
const groq = (text) => json(200, { choices: [{ message: { content: text } }] })

async function run(geminiText) {
  const orig = globalThis.fetch
  const hits = []
  globalThis.fetch = async (url) => {
    hits.push(String(url).includes('groq') ? 'groq' : 'gemini')
    return String(url).includes('groq') ? groq('[{"n":1,"ok":true,"why":"좋음"}]') : gemini(geminiText)
  }
  const log = console.log, err = console.error
  console.log = console.error = () => {}
  try {
    return { res: await judgeImages(items), hits }
  } finally {
    globalThis.fetch = orig
    console.log = log
    console.error = err
  }
}

test('Gemini 가 빈 배열을 주면 Groq 로 넘어간다', async () => {
  const { res, hits } = await run('[]')
  assert.ok(hits.includes('groq'))
  assert.equal(res?.get('w1')?.ok, true)
})

test('Gemini 가 번호 없는 판정만 주어도 Groq 로 넘어간다', async () => {
  const { res, hits } = await run('[{"n":9,"ok":true,"why":"x"}]')
  assert.ok(hits.includes('groq'))
  assert.equal(res?.get('w1')?.ok, true)
})

test('Gemini 가 제대로 답하면 Groq 는 안 부른다', async () => {
  const { res, hits } = await run('[{"n":1,"ok":false,"why":"다리가 5개"}]')
  assert.deepEqual([...new Set(hits)], ['gemini'])
  assert.equal(res.get('w1').ok, false)
})
