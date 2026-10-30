// scripts/judge.mjs — 검사 AI 차례(Groq → Gemini) · 빈 답 넘어가기 · 그림 줄이기 · 손 실행 예약. fetch 를 바꿔 끼워 네트워크 없이.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'

process.env.AI_RETRY_MS = '0'
process.env.GEMINI_API_KEY = 'k-g'
process.env.GROQ_API_KEY = 'k-q'
const { judgeImages, setJudgeLedger } = await import('../scripts/judge.mjs')
const { emptyLedger, ledgerConfig, recordJudgeUsage } = await import('../scripts/ledger.mjs')

const png = await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#fff' } }).png().toBuffer()
const items = [{ id: 'w1', word: 'Hund', meaning_ko: '개', png }]
const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
const gemini = (text) => json(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })
const groq = (text, total = 1234) => json(200, { choices: [{ message: { content: text } }], usage: { total_tokens: total } })
const OK = '[{"n":1,"ok":true,"why":"좋음"}]'

async function run({ groqText = OK, geminiText = OK, list = items } = {}) {
  const orig = globalThis.fetch
  const hits = []
  const sent = []
  globalThis.fetch = async (url, init) => {
    const g = String(url).includes('groq')
    hits.push(g ? 'groq' : 'gemini')
    const b = JSON.parse(init.body)
    sent.push(g ? b.messages[0].content.filter((c) => c.image_url).map((c) => c.image_url.url) : b.contents[0].parts.filter((p) => p.inline_data).map((p) => p.inline_data.data))
    return g ? groq(groqText) : gemini(geminiText)
  }
  const log = console.log, err = console.error
  console.log = console.error = () => {}
  try {
    return { res: await judgeImages(list), hits, sent }
  } finally {
    globalThis.fetch = orig
    console.log = log
    console.error = err
  }
}

test('기본 차례: Groq 가 답하면 Gemini 는 안 부른다', async () => {
  const { res, hits } = await run({ groqText: '[{"n":1,"ok":false,"why":"다리가 5개"}]' })
  assert.deepEqual([...new Set(hits)], ['groq'])
  assert.equal(res.get('w1').ok, false)
})

test('Groq 가 빈 배열을 주면 Gemini 로 넘어간다', async () => {
  const { res, hits } = await run({ groqText: '[]' })
  assert.deepEqual(hits, ['groq', 'gemini'])
  assert.equal(res?.get('w1')?.ok, true)
})

test('Groq 가 번호 없는 판정만 주어도 Gemini 로 넘어간다', async () => {
  const { res, hits } = await run({ groqText: '[{"n":9,"ok":true,"why":"x"}]' })
  assert.ok(hits.includes('gemini'))
  assert.equal(res?.get('w1')?.ok, true)
})

test('둘 다 못 주면 null(판정 못 함)', async () => {
  const { res } = await run({ groqText: '[]', geminiText: '[]' })
  assert.equal(res, null)
})

test('Groq 가 일부만 주면 못 받은 그림만 Gemini 로', async () => {
  const two = [...items, { id: 'w2', word: 'Katze', meaning_ko: '고양이', png }]
  const { res, hits, sent } = await run({ groqText: OK, list: two })
  assert.deepEqual(hits, ['groq', 'gemini'])
  assert.equal(sent[1].length, 1) // Gemini 에는 w2 한 장
  assert.equal(res.size, 2)
})

test('JUDGE_ORDER 로 차례를 바꾼다', async () => {
  process.env.JUDGE_ORDER = 'gemini,groq'
  try {
    const { hits } = await run()
    assert.deepEqual([...new Set(hits)], ['gemini'])
  } finally {
    delete process.env.JUDGE_ORDER
  }
})

test('검사 AI 에는 긴 변 512 로 줄인 그림을 보낸다', async () => {
  const { sent } = await run()
  const b64 = sent[0][0].replace('data:image/png;base64,', '')
  const m = await sharp(Buffer.from(b64, 'base64')).metadata()
  assert.equal(Math.max(m.width, m.height), 512)
})

test('사용량 장부: Groq 토큰 · Gemini 요청을 적는다', async () => {
  const ledger = emptyLedger()
  setJudgeLedger({ ledger, cfg: ledgerConfig({}), day: () => '2026-10-30' })
  try {
    await run({ groqText: '[]' })
    const j = ledger.days['2026-10-30'].judge
    assert.deepEqual(j.groq, { requests: 1, tokens: 1234 }) // 빈 답도 성공한 호출 — 다시 묻지 않고 Gemini 로
    assert.deepEqual(j.gemini, { requests: 1, tokens: 15 })
  } finally {
    setJudgeLedger(null)
  }
})

test('손 실행은 Groq 하루 토큰의 60% 까지만 — 넘으면 Gemini 만, 둘 다 막히면 null', async () => {
  const ledger = emptyLedger()
  const cfg = ledgerConfig({ DAILY_RUN_KIND: 'manual', GROQ_TPD: '200000', JUDGE_RESERVE: '0.4', GEMINI_RPD: '20' })
  recordJudgeUsage(ledger, '2026-10-30', 'groq', 119_000) // 60% = 120,000, 한 번 평균 119,000 → 넘는다
  setJudgeLedger({ ledger, cfg, day: () => '2026-10-30' })
  try {
    const a = await run()
    assert.deepEqual([...new Set(a.hits)], ['gemini'])
    for (let i = 0; i < 12; i++) recordJudgeUsage(ledger, '2026-10-30', 'gemini', 0) // 20 × 0.6 = 12
    const b = await run()
    assert.equal(b.res, null)
    assert.deepEqual(b.hits, [])
  } finally {
    setJudgeLedger(null)
  }
})

test('예약 실행은 같은 사용량에서도 Groq 를 부른다', async () => {
  const ledger = emptyLedger()
  const cfg = ledgerConfig({ DAILY_RUN_KIND: 'scheduled', GROQ_TPD: '200000' })
  recordJudgeUsage(ledger, '2026-10-30', 'groq', 20_000)
  setJudgeLedger({ ledger, cfg, day: () => '2026-10-30' })
  try {
    const { hits } = await run()
    assert.deepEqual([...new Set(hits)], ['groq'])
  } finally {
    setJudgeLedger(null)
  }
})
