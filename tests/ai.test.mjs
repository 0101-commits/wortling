// scripts/ai.mjs(Gemini) 검사 — fetch 를 바꿔 끼워 네트워크 없이. 키는 헤더로 · 그림은 inline_data · 퇴역(404)이면 다음 모델.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { askJson } from '../scripts/ai.mjs'

const reply = (status, json) => ({ ok: status < 400, status, json: async () => json })
const answer = (text) => reply(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } })

test('키가 없으면 부르지 않고 던진다', async () => {
  delete process.env.GEMINI_API_KEY
  await assert.rejects(askJson('x'), /GEMINI_API_KEY/)
})

test('퇴역(404)이면 다음 모델 · 키는 헤더 · 그림은 inline_data · 코드 울타리 벗김', async () => {
  process.env.GEMINI_API_KEY = 'k-test'
  const png = path.join(mkdtempSync(path.join(tmpdir(), 'ai-')), 'a.png')
  writeFileSync(png, Buffer.from('PNG'))
  const calls = []
  const orig = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return calls.length === 1 ? reply(404, { error: { message: 'model retired' } }) : answer('```json\n[{"n":1,"ok":true}]\n```')
  }
  try {
    assert.deepEqual(await askJson('판정', { images: [png] }), [{ n: 1, ok: true }])
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
  assert.deepEqual(parts[1], { inline_data: { mime_type: 'image/png', data: Buffer.from('PNG').toString('base64') } })
})
