// 화면 게이트: 목업 자료(VITE_MOCK=1)로 빌드 → vite preview → 모든 경로를 390·1280, light·dark 로 연다.
// 검사: 가로 넘침 0 · 화면보다 넓은 요소 0 · 콘솔 오류 0 · body 바탕 흰색(다크 선호에서도) · 덱 오른쪽 밀기 1번에 진행 수 증가.
// 사용: npm run gate   (Playwright 는 economic-site 에 설치된 것을 빌려 쓴다)
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire('C:/Users/cgpar/economic-site/package.json')('playwright')
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const OUT = 'dist-mock'
const SHOTS = join(ROOT, 'scripts/gates/shots')
const PORT = 4173
const BASE = `http://localhost:${PORT}/`
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js')

const ROUTES = ['/onboarding', '/today', '/words', '/word/w004', '/stats', '/inbox', '/settings']
const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 800 },
]
const SCHEMES = ['light', 'dark']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const fail = (msg) => failures.push(msg)

// 1) 목업 빌드(환경 변수는 셸 문법 대신 env 로 넘긴다)
console.log('· 목업 빌드 → ' + OUT)
const built = spawnSync(process.execPath, [VITE, 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'warn'], {
  cwd: ROOT,
  env: { ...process.env, VITE_MOCK: '1' },
  stdio: 'inherit',
})
if (built.status !== 0) {
  console.error('목업 빌드 실패')
  process.exit(1)
}

// 2) 미리보기 서버
const server = spawn(process.execPath, [VITE, 'preview', '--outDir', OUT, '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))

let browser
const table = []
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(BASE)).ok) break
    } catch {
      /* 아직 안 뜸 */
    }
    if (i > 100) throw new Error('미리보기 서버가 뜨지 않음\n' + serverLog)
    await sleep(100)
  }
  rmSync(SHOTS, { recursive: true, force: true })
  mkdirSync(SHOTS, { recursive: true })
  browser = await chromium.launch()

  for (const vp of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme, locale: 'ko-KR' })
      const page = await ctx.newPage()
      let errors = []
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
      page.on('pageerror', (e) => errors.push(String(e)))

      for (const route of ROUTES) {
        errors = []
        await page.goto(BASE + '#' + route, { waitUntil: 'networkidle' })
        await page.waitForSelector('main.page')
        await sleep(1000) // 목업 지연 120ms + 숫자 굴림 0.8s
        const m = await page.evaluate(() => {
          const de = document.documentElement
          const vw = de.clientWidth
          const wide = []
          for (const el of document.body.querySelectorAll('*')) {
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            if (r.width > vw + 0.5 || r.right > vw + 0.5 || r.left < -0.5) {
              wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${Math.round(r.left)}..${Math.round(r.right)}`)
            }
          }
          return { sw: de.scrollWidth, cw: de.clientWidth, wide: wide.slice(0, 5), bg: getComputedStyle(document.body).backgroundColor, htmlBg: getComputedStyle(de).backgroundColor }
        })
        const tag = `${route} @${vp.name} ${scheme}`
        const problems = []
        if (m.sw > m.cw) problems.push(`가로 넘침 ${m.sw}>${m.cw}`)
        if (m.wide.length) problems.push('넓은 요소 ' + m.wide.join(' | '))
        if (m.bg !== 'rgb(255, 255, 255)') problems.push('body 바탕 ' + m.bg)
        if (errors.length) problems.push('콘솔 오류 ' + errors.join(' | '))
        problems.forEach((p) => fail(`${tag}: ${p}`))
        await page.screenshot({ path: join(SHOTS, `${route.slice(1).replace(/\W+/g, '_')}-${vp.name}-${scheme}.png`), fullPage: true })
        let row = table.find((t) => t.route === route && t.vp === vp.name)
        if (!row) table.push((row = { route, vp: vp.name, light: '', dark: '', sw: '' }))
        row[scheme] = problems.length ? 'FAIL' : 'ok'
        row.sw = `${m.sw}/${m.cw}`
      }

      // 덱 밀기: 390 · light 에서 오른쪽으로 한 번
      if (vp.name === '390' && scheme === 'light') {
        errors = []
        await page.goto(BASE + '#/today', { waitUntil: 'networkidle' })
        const progress = page.getByTestId('progress')
        await progress.waitFor()
        const before = (await progress.textContent()).trim()
        const box = await page.getByTestId('deck-top').boundingBox()
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        for (let i = 1; i <= 12; i++) {
          await page.mouse.move(cx + i * 18, cy + i, { steps: 1 })
          await sleep(16)
        }
        await page.screenshot({ path: join(SHOTS, 'today-swiping-390.png') })
        await page.mouse.up()
        await sleep(700)
        const after = (await progress.textContent()).trim()
        const n = (s) => Number(s.split('/')[0])
        // 다음 카드가 기울거나 밀린 채 남으면 안 된다(이전 카드의 이동값이 새는 결함)
        const tilt = await page.getByTestId('deck-top').evaluate((el) => getComputedStyle(el).transform)
        const flat = tilt === 'none' || /^matrix\(1, 0, 0, 1, 0, 0\)$/.test(tilt)
        const ok = n(after) === n(before) + 1 && flat && errors.length === 0
        if (!ok) fail(`덱 밀기: 진행 수 ${before} → ${after} · 다음 카드 transform ${tilt}${errors.length ? ' · 콘솔 오류 ' + errors.join(' | ') : ''}`)
        table.push({ route: '덱 밀기 →', vp: '390', light: ok ? 'ok' : 'FAIL', dark: '-', sw: `${before} → ${after}` })
        await page.screenshot({ path: join(SHOTS, 'today-after-swipe-390.png') })

        // 키보드: Z 되돌리기 → → 좋음, 탭 = 뒤집기
        await page.keyboard.press('z')
        await sleep(100)
        const undone = (await progress.textContent()).trim()
        await page.keyboard.press('ArrowRight')
        await sleep(600)
        const keyed = (await progress.textContent()).trim()
        await page.getByTestId('deck-top').click()
        await sleep(300)
        const flipped = await page.getByTestId('deck-top').locator('.dk-mn').count()
        await page.screenshot({ path: join(SHOTS, 'today-back-390.png') })
        const kok = undone === before && n(keyed) === n(before) + 1 && flipped === 1 && errors.length === 0
        if (!kok) fail(`덱 키보드·탭: Z → ${undone}, → → ${keyed}, 뒤집힘 ${flipped}`)
        table.push({ route: '덱 Z · → · 탭', vp: '390', light: kok ? 'ok' : 'FAIL', dark: '-', sw: `${undone} → ${keyed} · 뒤 ${flipped}` })

        // 끝까지 채점 → 「오늘 끝」 화면(전송 1번 + 내일 수)
        for (let i = 0; i < 40 && (await progress.count()); i++) {
          await page.keyboard.press('ArrowRight')
          await sleep(330)
        }
        await page.getByText('오늘 끝').waitFor({ timeout: 3000 }).catch(() => undefined)
        await sleep(1200)
        const done = await page.getByText('오늘 끝').count()
        const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        await page.screenshot({ path: join(SHOTS, 'today-done-390.png') })
        const dok = done === 1 && sw <= 0 && errors.length === 0
        if (!dok) fail(`덱 끝 화면: 오늘 끝 ${done} · 넘침 ${sw}${errors.length ? ' · 콘솔 오류 ' + errors.join(' | ') : ''}`)
        table.push({ route: '덱 끝까지', vp: '390', light: dok ? 'ok' : 'FAIL', dark: '-', sw: done ? '오늘 끝' : '안 끝남' })
      }
      await ctx.close()
    }
  }
} catch (e) {
  fail('게이트 실행 오류: ' + (e?.stack ?? e))
} finally {
  await browser?.close()
  server.kill()
  rmSync(join(ROOT, OUT), { recursive: true, force: true })
}

console.log('\n| 경로 | 폭 | light | dark | scrollWidth/clientWidth |')
console.log('|---|---|---|---|---|')
for (const r of table) console.log(`| ${r.route} | ${r.vp} | ${r.light} | ${r.dark} | ${r.sw} |`)
console.log(`\n스크린샷: scripts/gates/shots/`)
if (failures.length) {
  console.error(`\n실패 ${failures.length}건`)
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log('\n게이트 통과')
