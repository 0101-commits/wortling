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

const ROUTES = ['/onboarding', '/today', '/words', '/word/w004', '/stats', '/inbox', '/settings', '/setup', '/drill?scope=week&n=10', '/artikel', '/changes', '/words?add=Ermittlung&url=https%3A%2F%2Fwww.dw.com%2Fde%2Fx']
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
            if (el.parentElement?.closest('[data-hscroll]')) continue // 가로 스크롤 줄 안(줄 자체는 검사한다)
            if (r.width > vw + 0.5 || r.right > vw + 0.5 || r.left < -0.5) {
              wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${Math.round(r.left)}..${Math.round(r.right)}`)
            }
          }
          // iOS 는 16px 미만 입력칸에서 확대한다 · 보르티 그림이 실제로 그려졌는지
          const smallInputs = [...document.querySelectorAll('input, textarea, select')]
            .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
            .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.type}] ${getComputedStyle(el).fontSize}`)
          const brokenEmoji = [...document.querySelectorAll('img.emoji')].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src'))
          return {
            sw: de.scrollWidth,
            cw: de.clientWidth,
            wide: wide.slice(0, 5),
            bg: getComputedStyle(document.body).backgroundColor,
            smallInputs,
            brokenEmoji,
            emoji: document.querySelectorAll('img.emoji').length,
          }
        })
        const tag = `${route} @${vp.name} ${scheme}`
        const problems = []
        if (m.sw > m.cw) problems.push(`가로 넘침 ${m.sw}>${m.cw}`)
        if (m.wide.length) problems.push('넓은 요소 ' + m.wide.join(' | '))
        if (m.bg !== 'rgb(255, 255, 255)') problems.push('body 바탕 ' + m.bg)
        if (errors.length) problems.push('콘솔 오류 ' + errors.join(' | '))
        if (m.smallInputs.length) problems.push('16px 미만 입력칸 ' + m.smallInputs.join(' | '))
        if (m.brokenEmoji.length) problems.push('안 그려진 이모티콘 ' + m.brokenEmoji.join(' | '))
        problems.forEach((p) => fail(`${tag}: ${p}`))
        await page.screenshot({ path: join(SHOTS, `${route.slice(1).replace(/\W+/g, '_')}-${vp.name}-${scheme}.png`), fullPage: true })
        let row = table.find((t) => t.route === route && t.vp === vp.name)
        if (!row) table.push((row = { route, vp: vp.name, light: '', dark: '', sw: '' }))
        row[scheme] = problems.length ? 'FAIL' : 'ok'
        row.sw = `${m.sw}/${m.cw}` + (m.emoji ? ` · 보르티 ${m.emoji}` : '')
      }

      // 연결 설정: QR 이 그려지고, 웹후크를 붙여 넣고 저장하면 토스트 + 「연결됨」
      if (vp.name === '390' && scheme === 'light') {
        errors = []
        await page.goto(BASE + '#/setup', { waitUntil: 'networkidle' })
        await page.getByLabel('디스코드 웹후크 주소').fill('https://discord.com/api/webhooks/123/abc-DEF')
        await page.getByRole('button', { name: '저장하고 시험 통 보내기' }).click()
        const toasted = await page.getByText('디스코드에 시험 통이 갔어요').waitFor({ timeout: 3000 }).then(() => true, () => false)
        await sleep(300)
        const linked = await page.getByText('연결됨', { exact: true }).count()
        const qr = await page.locator('svg.qr path').count()
        await page.screenshot({ path: join(SHOTS, 'setup-saved-390.png'), fullPage: true })
        const wok = toasted && linked === 1 && qr === 1 && errors.length === 0
        if (!wok) fail(`연결 설정: 토스트 ${toasted} · 연결됨 ${linked} · QR ${qr}${errors.length ? ' · 콘솔 오류 ' + errors.join(' | ') : ''}`)
        table.push({ route: '웹후크 저장', vp: '390', light: wok ? 'ok' : 'FAIL', dark: '-', sw: toasted ? '토스트 · 연결됨' : '실패' })

        // 온보딩 O2 도 같은 웹후크 부품
        await page.goto(BASE + '#/onboarding', { waitUntil: 'networkidle' })
        await page.reload({ waitUntil: 'networkidle' }) // 해시만 바뀌면 문서가 그대로라 목업이 방금 저장한 웹후크를 기억한다
        await page.getByRole('button', { name: '다음' }).click()
        await page.getByLabel('디스코드 웹후크 주소').waitFor({ timeout: 3000 }).catch(() => undefined)
        const o2 = await page.getByLabel('디스코드 웹후크 주소').count()
        const o2sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        await page.screenshot({ path: join(SHOTS, 'onboarding-o2-390.png'), fullPage: true })
        const ook = o2 === 1 && o2sw <= 0 && errors.length === 0
        if (!ook) fail(`온보딩 O2: 웹후크 칸 ${o2} · 넘침 ${o2sw}`)
        table.push({ route: '온보딩 O2', vp: '390', light: ook ? 'ok' : 'FAIL', dark: '-', sw: o2 ? '웹후크 칸 있음' : '없음' })
      }

      // 단어 칩 C1: 7개 칩 줄, 누르면 C1 단어만
      if (vp.name === '390' && scheme === 'light') {
        errors = []
        await page.goto(BASE + '#/words', { waitUntil: 'networkidle' })
        await page.reload({ waitUntil: 'networkidle' })
        await page.waitForSelector('.list .cell')
        const chipRow = await page.locator('.chips').evaluate((el) => ({ n: el.children.length, sw: el.scrollWidth, cw: el.clientWidth }))
        await page.getByRole('button', { name: 'C1', exact: true }).click()
        await page.waitForFunction(() => document.querySelectorAll('.list [data-level]').length > 0 && [...document.querySelectorAll('.list [data-level]')].every((b) => b.getAttribute('data-level') === 'C1'), null, { timeout: 3000 }).catch(() => undefined)
        const levels = await page.locator('.list [data-level]').evaluateAll((els) => els.map((e) => e.getAttribute('data-level')))
        const psw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        await page.screenshot({ path: join(SHOTS, 'words-c1-390.png'), fullPage: true })
        const cok = chipRow.n === 7 && levels.length > 0 && levels.every((l) => l === 'C1') && psw <= 0 && errors.length === 0
        if (!cok) fail(`단어 칩 C1: 칩 ${chipRow.n} · 결과 레벨 ${levels.join(',')} · 페이지 넘침 ${psw}`)
        table.push({ route: '단어 칩 C1', vp: '390', light: cok ? 'ok' : 'FAIL', dark: '-', sw: `칩 ${chipRow.n} (${chipRow.sw > chipRow.cw ? '가로 스크롤' : '한 줄에 다 보임'}) · C1 ${levels.length}개` })
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

        // 「이상해요」 창이 열려 있으면 화살표·스페이스가 뒤 카드를 채점·뒤집지 않는다(최종 검토 반영)
        await page.getByRole('button', { name: '이상해요' }).click()
        await sleep(200)
        const beforeDlg = (await progress.textContent()).trim()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press(' ')
        await sleep(600)
        const afterDlg = (await progress.textContent()).trim()
        const dlgOpen = await page.locator('dialog.report-dlg[open]').count()
        await page.screenshot({ path: join(SHOTS, 'today-report-390.png') })
        await page.keyboard.press('Escape')
        await sleep(200)
        const rok = afterDlg === beforeDlg && dlgOpen === 1 && errors.length === 0
        if (!rok) fail(`이상해요 창 + 키: 진행 수 ${beforeDlg} → ${afterDlg}, 창 열림 ${dlgOpen}`)
        table.push({ route: '이상해요 창 + → ·스페이스', vp: '390', light: rok ? 'ok' : 'FAIL', dark: '-', sw: `${beforeDlg} → ${afterDlg} · 창 ${dlgOpen}` })

        // 끝까지 채점 → 「오늘 끝」 화면(전송 1번 + 내일 수)
        for (let i = 0; i < 40 && (await progress.count()); i++) {
          await page.keyboard.press('ArrowRight')
          await sleep(330)
        }
        await page.getByText('오늘 끝').waitFor({ timeout: 3000 }).catch(() => undefined)
        await sleep(1200)
        const done = await page.getByText('오늘 끝').count()
        const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        const happy = await page.evaluate(() => [...document.querySelectorAll('img.emoji')].filter((i) => i.complete && i.naturalWidth > 0).length)
        await page.screenshot({ path: join(SHOTS, 'today-done-390.png') })
        const dok = done === 1 && sw <= 0 && happy === 1 && errors.length === 0
        if (!dok) fail(`덱 끝 화면: 오늘 끝 ${done} · 넘침 ${sw} · 보르티 ${happy}${errors.length ? ' · 콘솔 오류 ' + errors.join(' | ') : ''}`)
        table.push({ route: '덱 끝까지', vp: '390', light: dok ? 'ok' : 'FAIL', dark: '-', sw: done ? '오늘 끝' : '안 끝남' })
      }
      await ctx.close()
    }
  }

  // 폰 흉내(터치·확대 막기): 손가락 하나로 밀면 채점되고, 화면 배율은 1 그대로
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'ko-KR' })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(BASE + '#/today', { waitUntil: 'networkidle' })
    const progress = page.getByTestId('progress')
    await progress.waitFor()
    const before = (await progress.textContent()).trim()
    const box = await page.getByTestId('deck-top').boundingBox()
    const cx = Math.round(box.x + box.width / 2)
    const cy = Math.round(box.y + box.height / 2)
    const cdp = await ctx.newCDPSession(page)
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts })
    await touch('touchStart', [{ x: cx, y: cy }])
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', [{ x: cx + i * 18, y: cy + i }])
      await sleep(16)
    }
    await touch('touchEnd', [])
    await sleep(700)
    const after = (await progress.textContent()).trim()
    // 손가락 두 개로 벌리기 → 배율이 1 이어야 한다
    await touch('touchStart', [{ x: 150, y: 300, id: 1 }, { x: 240, y: 300, id: 2 }])
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', [{ x: 150 - i * 12, y: 300, id: 1 }, { x: 240 + i * 12, y: 300, id: 2 }])
      await sleep(16)
    }
    await touch('touchEnd', [])
    await sleep(300)
    const scale = await page.evaluate(() => window.visualViewport?.scale ?? 1)
    const viewportMeta = await page.evaluate(() => document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '')
    const n = (s) => Number(s.split('/')[0])
    const ok = n(after) === n(before) + 1 && scale === 1 && /user-scalable=no/.test(viewportMeta) && errors.length === 0
    if (!ok) fail(`터치 밀기: ${before} → ${after} · 배율 ${scale} · viewport "${viewportMeta}"${errors.length ? ' · 콘솔 오류 ' + errors.join(' | ') : ''}`)
    table.push({ route: '터치 밀기 · 확대 막기', vp: '390 폰', light: ok ? 'ok' : 'FAIL', dark: '-', sw: `${before} → ${after} · 배율 ${scale}` })
    await page.screenshot({ path: join(SHOTS, 'today-touch-390.png') })
    await ctx.close()
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
