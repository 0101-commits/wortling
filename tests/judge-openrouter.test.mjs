// scripts/judge.mjs · ai.mjs 의 OpenRouter 길 — 차례(groq → gemini → openrouter) · 빈 답 = 실패 · 모델 폴백 · 하루 한도·손 실행 예약. fetch 를 바꿔 끼워 네트워크 없이.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'

process.env.AI_RETRY_MS = '0'
process.env.GEMINI_API_KEY = 'k-g'
process.env.GROQ_API_KEY = 'k-q'
process.env.OPENROUTER_API_KEY = 'k-o'
process.env.OPENROUTER_MODEL = 'm/one:free,m/two:free'
const { judgeImages, setJudgeLedger } = await import('../scripts/judge.mjs')
const { emptyLedger, ledgerConfig, recordJudgeUsage } = await import('../scripts/ledger.mjs')

const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#fff' } }).png().toBuffer()
const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, word: `W${i + 1}`, meaning_ko: '뜻', png }))
const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
const chat = (content) => json(200, { choices: [{ message: { content } }], usage: { total_tokens: 99 } })
const okFor = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ n: i + 1, ok: true, why: '좋음' })))

// who: 요청 주소로 길을 가르고, openrouter 는 모델 이름별 답(reply(model, nImages))
async function run(list, reply) {
  const orig = globalThis.fetch
  const hits = []
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('openrouter')) {
      const b = JSON.parse(init.body)
      hits.push(`or:${b.model}`)
      assert.equal(init.headers.authorization, 'Bearer k-o')
      return reply(b.model, b.messages[0].content.filter((c) => c.image_url).length)
    }
    hits.push(u.includes('groq') ? 'groq' : 'gemini')
    return json(503, { error: { message: 'down' } })
  }
  const log = console.log, err = console.error
  console.log = console.error = () => {}
  try {
    return { res: await judgeImages(list), hits }
  } finally {
    globalThis.fetch = orig
    console.log = log
    console.error = err
  }
}

test('기본 차례: groq · gemini 가 막히면 openrouter 가 판정', async () => {
  const { res, hits } = await run(mk(1), (m, n) => chat(okFor(n)))
  assert.equal(res?.get('w1')?.ok, true)
  assert.ok(hits.indexOf('groq') < hits.indexOf('gemini') && hits.indexOf('gemini') < hits.indexOf('or:m/one:free'))
})

test('빈 답은 실패 — 다음 모델로, 다음 모델이 주면 쓴다', async () => {
  const { res, hits } = await run(mk(1), (m, n) => (m === 'm/one:free' ? chat('') : chat(okFor(n))))
  assert.equal(res?.get('w1')?.ok, true)
  assert.ok(hits.includes('or:m/one:free') && hits.includes('or:m/two:free'))
})

test('모델 둘 다 빈 답이면 null', async () => {
  const { res } = await run(mk(1), () => chat(''))
  assert.equal(res, null)
})

test('4xx(키·모델 오류)는 다시 묻지 않고 다음 모델로', async () => {
  const { hits } = await run(mk(1), (m, n) => (m === 'm/one:free' ? json(404, { error: { message: 'no endpoint' } }) : chat(okFor(n))))
  assert.equal(hits.filter((h) => h === 'or:m/one:free').length, 1)
})

test('openrouter 는 3장씩 끊어 부른다', async () => {
  const { res, hits } = await run(mk(7), (m, n) => chat(okFor(n)))
  assert.equal(res.size, 7)
  assert.equal(hits.filter((h) => h === 'or:m/one:free').length, 3) // 3+3+1
})

test('하루 한도(요청 수): 다 쓰면 부르지 않고, 손 실행은 60% 까지만', async () => {
  const day = '2026-10-30'
  const sched = emptyLedger()
  const cfgS = ledgerConfig({ DAILY_RUN_KIND: 'scheduled', OPENROUTER_RPD: '40' })
  for (let i = 0; i < 40; i++) recordJudgeUsage(sched, day, 'openrouter', 0)
  setJudgeLedger({ ledger: sched, cfg: cfgS, day: () => day })
  try {
    const a = await run(mk(1), (m, n) => chat(okFor(n)))
    assert.equal(a.hits.filter((h) => h.startsWith('or:')).length, 0)
  } finally {
    setJudgeLedger(null)
  }
  const man = emptyLedger()
  const cfgM = ledgerConfig({ DAILY_RUN_KIND: 'manual', OPENROUTER_RPD: '40', JUDGE_RESERVE: '0.4' }) // 40 × 0.6 = 24
  for (let i = 0; i < 23; i++) recordJudgeUsage(man, day, 'openrouter', 0)
  setJudgeLedger({ ledger: man, cfg: cfgM, day: () => day })
  try {
    const b = await run(mk(6), (m, n) => chat(okFor(n))) // 24번째 한 번만 허용 → 3장
    assert.equal(b.hits.filter((h) => h.startsWith('or:')).length, 1)
    assert.equal(b.res.size, 3)
    assert.equal(man.days[day].judge.openrouter.requests, 24)
  } finally {
    setJudgeLedger(null)
  }
})
