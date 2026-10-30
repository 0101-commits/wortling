// scripts/ledger.mjs — 모델별 뉴런 값 · 모델 섞기(3일 50/50 → 비례 + 바닥) · 예산 · 어려운 단어 · 손 실행 예약
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  KLEIN4, SCHNELL, KLEIN9, DEV, neuronCost, neuronEstimate, ledgerConfig, emptyLedger, loadLedger, saveLedger, recordDraw, recordAuto, recordJudge,
  allocateShares, pickModel, seedFloor, applyManualDecisions, sentButFailed, hardCandidates, hardSlot, spentToday, recordJudgeUsage, judgeAllowed,
} from '../scripts/ledger.mjs'

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)
const cfg = ledgerConfig({})

test('뉴런 값: 공식 가격표대로(보정 전)', () => {
  near(neuronCost(KLEIN4), 5.37 + 3 * 26.05) // 1024×768 = 3칸, 참고 그림 1칸 ≈ 83.5
  near(neuronCost(KLEIN4, { ref: false }), 78.15)
  near(neuronCost(SCHNELL), 4 * 4.8 + 4 * 9.6) // 1024² = 4칸, 4걸음 = 57.6
  near(neuronCost(SCHNELL, { steps: 8 }), 19.2 + 76.8)
  near(neuronCost(KLEIN9), 1363.64 + 181.82 * 0.262144) // 출력 첫 1MP + 참고 그림 입력
  near(neuronCost(KLEIN9, { w: 2048, h: 1024, ref: false }), 1363.64 + 181.82 * (2.097152 - 1))
  near(neuronCost(DEV, { steps: 20 }), (37.5 * 3 + 18.75) * 20)
  assert.throws(() => neuronCost('@cf/x/y'), /모르는 모델/)
})

test('설정: 예산 = 10,000 − 여유 · 보정 1.3 · 환경값', () => {
  assert.equal(cfg.budget, 9000)
  near(neuronEstimate(KLEIN4, cfg), 83.52 * 1.3, 0.05)
  const c = ledgerConfig({ NEURON_MARGIN: '2000', NEURON_FACTOR: '1', DAILY_HARD_MODEL: 'dev', DAILY_HARD_MAX: '2' })
  assert.equal(c.budget, 8000)
  assert.equal(c.hardModel, DEV)
  assert.equal(c.hardMax, 2)
  assert.equal(ledgerConfig({}).hardModel, KLEIN9) // 기본은 9b, dev 는 환경값으로만
})

test('섞기: 처음 3일은 50/50', () => {
  const l = emptyLedger()
  recordDraw(l, '2026-10-30', KLEIN4, 100)
  recordDraw(l, '2026-10-30', SCHNELL, 100)
  for (let i = 0; i < 9; i++) recordJudge(l, `a${i}`, KLEIN4, true) // 자료가 한쪽에 쏠려도
  assert.deepEqual(allocateShares(l, '2026-10-30', cfg), { [KLEIN4]: 0.5, [SCHNELL]: 0.5 })
  assert.deepEqual(allocateShares(l, '2026-11-01', cfg), { [KLEIN4]: 0.5, [SCHNELL]: 0.5 }) // 3일째(0·1·2일차)까지
})

test('섞기: 4일째부터 통과/뉴런 비례 · 바닥 20%', () => {
  const l = emptyLedger()
  recordDraw(l, '2026-10-30', KLEIN4, 1000)
  recordDraw(l, '2026-10-30', SCHNELL, 1000)
  for (let i = 0; i < 30; i++) recordJudge(l, `k${i}`, KLEIN4, true)
  for (let i = 0; i < 10; i++) recordJudge(l, `s${i}`, SCHNELL, true)
  const s = allocateShares(l, '2026-11-02', cfg) // 효율 0.03 : 0.01 → 75 : 25
  near(s[KLEIN4], 0.75)
  near(s[SCHNELL], 0.25)
  // 한쪽이 0장 통과 → 바닥 20% 는 지킨다
  const z = emptyLedger()
  recordDraw(z, '2026-10-30', KLEIN4, 1000)
  recordDraw(z, '2026-10-30', SCHNELL, 1000)
  recordJudge(z, 'k', KLEIN4, true)
  const t = allocateShares(z, '2026-11-02', cfg)
  near(t[SCHNELL], 0.2)
  near(t[KLEIN4], 0.8)
  // 통과가 둘 다 0 이면 균등
  const e = emptyLedger()
  recordDraw(e, '2026-10-30', KLEIN4, 1000)
  recordDraw(e, '2026-10-30', SCHNELL, 1000)
  assert.deepEqual(allocateShares(e, '2026-11-02', cfg), { [KLEIN4]: 0.5, [SCHNELL]: 0.5 })
})

test('pickModel: 몫이 더 남은 모델부터 · 예산이 바닥나면 null', () => {
  const l = emptyLedger()
  const day = '2026-10-30'
  const counts = { [KLEIN4]: 0, [SCHNELL]: 0 }
  for (;;) {
    const p = pickModel(l, day, cfg)
    if (!p) break
    counts[p.model]++
    recordDraw(l, day, p.model, p.cost)
  }
  assert.ok(spentToday(l, day) <= cfg.budget)
  assert.ok(cfg.budget - spentToday(l, day) < neuronEstimate(KLEIN4, cfg)) // 한 장도 더 못 그릴 만큼만 남음
  // 뉴런은 50/50, 장수는 싼 schnell 이 더 많다
  assert.ok(counts[SCHNELL] > counts[KLEIN4])
  const d = l.days[day].neurons
  near(d[KLEIN4] / (d[KLEIN4] + d[SCHNELL]), 0.5, 0.03)
})

test('어려운 단어: 두 번 탈락 → 후보 · 한 번 그리면 빠짐 · 오늘 횟수/뉴런 몫', () => {
  const l = emptyLedger()
  recordJudge(l, 'w1', KLEIN4, false)
  assert.deepEqual(hardCandidates(l, cfg), [])
  recordJudge(l, 'w1', KLEIN4, false)
  recordJudge(l, 'w2', SCHNELL, false)
  assert.deepEqual(hardCandidates(l, cfg), ['w1'])
  l.hard_tried.w1 = '2026-10-30'
  assert.deepEqual(hardCandidates(l, cfg), [])
  recordJudge(l, 'w2', SCHNELL, true) // 통과하면 탈락 기록을 지움
  assert.equal(l.fails.w2, undefined)

  const day = '2026-10-30'
  const cost = neuronEstimate(KLEIN9, cfg)
  near(hardSlot(l, day, cfg), cost)
  recordDraw(l, day, KLEIN9, cost)
  assert.equal(hardSlot(l, day, cfg), null) // 하루 1개
  assert.ok(hardSlot(l, day, ledgerConfig({ DAILY_HARD_MAX: '2' })) !== null)
  // 뉴런이 모자라면 횟수가 남아도 막힘
  const poor = emptyLedger()
  recordDraw(poor, day, SCHNELL, 8500)
  assert.equal(hardSlot(poor, day, cfg), null)
})

test('장부 저장·읽기: 깨진 파일은 새 장부 · 날짜는 14일치만', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-'))
  try {
    const f = path.join(dir, 'ledger.json')
    assert.deepEqual(loadLedger(f), { ...emptyLedger(), recovered: true })
    const l = emptyLedger()
    for (let d = 1; d <= 20; d++) recordDraw(l, `2026-10-${String(d).padStart(2, '0')}`, KLEIN4, 10)
    recordAuto(l, KLEIN4, true)
    saveLedger(f, l)
    const back = loadLedger(f)
    assert.equal(Object.keys(back.days).length, 14)
    assert.equal(back.stats[KLEIN4].auto_pass, 1)
    assert.equal(back.start, '2026-10-01')
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('어려운 단어 몫은 섞기 몫에서 빠진다(예산 안)', () => {
  const l = emptyLedger()
  const day = '2026-10-30'
  recordDraw(l, day, KLEIN9, neuronEstimate(KLEIN9, cfg))
  for (;;) {
    const p = pickModel(l, day, cfg)
    if (!p) break
    recordDraw(l, day, p.model, p.cost)
  }
  assert.ok(spentToday(l, day) <= cfg.budget)
})

test('검사 AI 예약: 손 실행은 60% 까지, 예약 실행은 한도까지', () => {
  const l = emptyLedger()
  const day = '2026-10-30'
  const manual = ledgerConfig({ DAILY_RUN_KIND: 'manual' })
  const sched = ledgerConfig({ DAILY_RUN_KIND: 'scheduled' })
  assert.equal(manual.manual, true)
  assert.equal(sched.manual, false)
  assert.equal(ledgerConfig({ GITHUB_EVENT_NAME: 'schedule' }).manual, false)
  assert.equal(ledgerConfig({ GITHUB_EVENT_NAME: 'workflow_dispatch' }).manual, true)
  assert.equal(judgeAllowed(l, day, 'groq', manual), true)
  recordJudgeUsage(l, day, 'groq', 100_000) // 평균 100k/번
  assert.equal(judgeAllowed(l, day, 'groq', manual), false) // 100k + 평균 100k > 120k(60%)
  assert.equal(judgeAllowed(l, day, 'groq', sched), true) // 200k ≤ 200k
  recordJudgeUsage(l, day, 'groq', 20_000) // 평균 60k, 합 120k
  assert.equal(judgeAllowed(l, day, 'groq', manual), false)
  assert.equal(judgeAllowed(l, day, 'groq', sched), true) // 120k + 60k ≤ 200k
  for (let i = 0; i < 12; i++) recordJudgeUsage(l, day, 'gemini', 0)
  assert.equal(judgeAllowed(l, day, 'gemini', manual), false) // 12 + 1 > 12
  assert.equal(judgeAllowed(l, day, 'gemini', sched), true)
  assert.equal(judgeAllowed(l, day, 'groq', ledgerConfig({ DAILY_RUN_KIND: 'manual', JUDGE_RESERVE: '0' })), true) // 예약 0 이면 한도까지
})

test('장부 저장은 임시 파일 + 이름 바꾸기 — 임시 파일이 안 남고 recovered 는 저장 안 함', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'led-'))
  try {
    const f = path.join(dir, 'ledger.json')
    const l = loadLedger(f)
    assert.equal(l.recovered, true, '없으면 recovered')
    recordDraw(l, '2026-10-30', KLEIN4, 100)
    saveLedger(f, l)
    assert.deepEqual(readdirSync(dir), ['ledger.json'])
    const back = loadLedger(f)
    assert.equal(back.recovered, undefined)
    assert.equal(spentToday(back, '2026-10-30'), 100)
    writeFileSync(f, '{"days":') // 반쪽 JSON
    assert.equal(loadLedger(f).recovered, true, '깨졌으면 recovered')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('장부를 잃은 날: 오늘 그린 횟수 × 어림으로 바닥을 깐다(한 번만 · 첫 실행이면 0)', () => {
  const lost = { ...emptyLedger(), recovered: true }
  const floor = seedFloor(lost, '2026-10-30', 50, cfg)
  near(floor, 50 * neuronEstimate(KLEIN4, cfg), 0.01)
  assert.equal(spentToday(lost, '2026-10-30'), floor)
  assert.equal(seedFloor(lost, '2026-10-30', 50, cfg), 0, 'recovered 표시는 한 번만')
  assert.equal(seedFloor({ ...emptyLedger(), recovered: true }, '2026-10-30', 0, cfg), 0)
  assert.equal(seedFloor(emptyLedger(), '2026-10-30', 50, cfg), 0, '멀쩡한 장부는 그대로')
})

test('보낸 뒤 실패한 그리기는 뉴런을 적는다: 네트워크·5xx 는 적고 4xx 는 안 적는다', () => {
  assert.equal(sentButFailed(new Error('fetch failed')), true)
  assert.equal(sentButFailed(new Error('POST /api/admin/draw → 502 upstream')), true)
  assert.equal(sentButFailed(new Error('POST /api/admin/draw → 504 timeout')), true)
  assert.equal(sentButFailed(new Error('POST /api/admin/draw → 429 quota')), false)
  assert.equal(sentButFailed(new Error('POST /api/admin/draw → 400 bad')), false)
})

test('날짜마다 따로: 자정 넘은 그림은 새 날 장부에, 예산도 그 날 몫으로 본다', () => {
  const l = emptyLedger()
  const c = ledgerConfig({ NEURON_DAILY: '200', NEURON_MARGIN: '0' })
  recordDraw(l, '2026-10-30', KLEIN4, 190)
  assert.equal(pickModel(l, '2026-10-30', c), null)
  assert.ok(pickModel(l, '2026-10-31', c), '새 날은 예산이 다시 열림')
  recordDraw(l, '2026-10-31', KLEIN4, 50)
  assert.equal(spentToday(l, '2026-10-30'), 190)
  assert.equal(spentToday(l, '2026-10-31'), 50)
})

test('앱 결정 반영: 승인 = 통과 · 목록에서 뺌 · 탈락 횟수 지움 / 다시 그리기 = 탈락 1회', () => {
  const l = emptyLedger()
  l.drawn_by.a = KLEIN4
  l.drawn_by.b = SCHNELL
  l.fails.a = 2
  l.fails.b = 1
  const restyle = ['a', 'b', 'c']
  const fix = new Map([['a', 'scene']])
  const done = applyManualDecisions(l, [{ id: 'a', ok: true }, { id: 'b', ok: false }], [restyle, fix])
  assert.deepEqual(done, ['a', 'b'])
  assert.deepEqual(restyle, ['b', 'c'], '승인된 a 만 뺀다')
  assert.equal(fix.has('a'), false)
  assert.equal(l.fails.a, undefined)
  assert.equal(l.fails.b, 2, '다시 그리기는 탈락으로 센다 → 2번이면 어려운 단어')
  assert.equal(l.stats[KLEIN4].judge_pass, 1)
  assert.equal(l.stats[SCHNELL].judge_fail, 1)
  assert.deepEqual(hardCandidates(l, cfg), ['b'])
})

test('모델별 보정 계수: 환경값으로 따로, 없으면 NEURON_FACTOR', () => {
  const c = ledgerConfig({ NEURON_FACTOR: '1', NEURON_FACTOR_SCHNELL: '2' })
  near(neuronEstimate(SCHNELL, c), neuronCost(SCHNELL, { steps: 4 }) * 2)
  near(neuronEstimate(KLEIN4, c), neuronCost(KLEIN4))
})
