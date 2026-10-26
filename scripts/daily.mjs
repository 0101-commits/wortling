// 매일 아침 PC 에서 한 번 도는 스크립트(작업 스케줄러 → scripts/register-task.ps1).
// 하는 일 둘:
//   1) 글 채우기 — 다가오는 단어(학습 순서 앞쪽) 가운데 한국어 뜻·예문·장면이 빈 것을 AI(Gemini)로 채운다.
//   2) 그림 만들기 — Worker 의 POST /api/admin/draw(Cloudflare Workers AI FLUX.2 klein 4b, 무료 하루 10,000 뉴런 ≈ 100장)로
//      장면이 있는 단어의 그림을 만들어 올린다. 무료 몫을 다 쓰면 429(quota) → 그날은 멈춤.
//      그림 검사 AI(Gemini Flash)가 막히면 그린 그림을 버리지 않고 Worker 의 「검사 대기」(KV pending/<id>.webp)에 맡기고,
//      다음 실행이 맨 먼저 검사해 올린다(scripts/pending.mjs). 대기가 80장이면 그리기를 멈춘다. 탈락 그림은 .data/rejected/ 에 남긴다.
//      매일 이어서 그리다가 그릴 단어가 하나도 안 남으면 「전부 완료」 알림을 한 번 보낸다(새 단어가 들어오면 다시 그림).
// Worker 관리 API 만 쓴다(그림은 wrangler 불필요). 준비물: .env(APP_URL · API_TOKEN), GEMINI_API_KEY(.env 또는 비밀값).
// 되풀이해도 안전하다 — 이미 채워진 단어·그림은 다시 하지 않는다.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { STYLE_INTRO, BORTI, STYLE, REF_NOTE, REF_FILE } from './style.mjs';
import { checkFile } from './imgcheck.mjs';
import { askJson } from './ai.mjs';
import { judgeImages } from './judge.mjs';
import { processPending, sortByVerdict } from './pending.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));

const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || '';
const TEXT_AHEAD = Number(process.env.DAILY_TEXT_AHEAD || 60); // 글을 미리 채워 둘 단어 수
// 하루 그림 상한. 10,000 뉴런 ÷ (그림 78 + 참고 그림 입력) — 뜻 검사 탈락 다시 그리기 몫을 남김. 넘치면 429 로 멈출 뿐
const IMAGE_MAX = Number(process.env.DAILY_IMAGE_MAX || 100);
// 하루 그리기 횟수 상한(검사·뜻 탈락 다시 그리기 포함). 계산상 한 번 ≈ 83 뉴런이었는데 대시보드 실측은 ≈ 109
// (10-16·10-17 110번 = 12k, 어림 9,174) → 110번은 무료 10,000 을 넘겼고 10-18·10-19 는 하루 종일 4006 으로 0장.
// 80번 ≈ 8,700(87%). 몫을 끝까지 쓰면 안 된다 — 다 쓴 다음 날도 막힌 적이 있다(10-15, 문서는 「UTC 0시 초기화」)
const DRAW_MAX = Number(process.env.DAILY_DRAW_MAX) || 80; // 숫자가 아니면(NaN) 상한이 꺼지지 않게 기본값
// 위 상한은 실행마다가 아니라 하루(UTC = Workers AI 무료 몫 기준)마다. 예전엔 daily.yml guard 가 「오늘 성공한 실행이 있으면」
// 예약 실행을 통째로 건너뛰어, 몫이 막혀 0장 그린 손 실행(다시 검사)만 있던 10-19 저녁에도 그리지 않았다
const DRAW_DAY_FILE = path.join(ROOT, '.data', 'draw-day.json');
// 그리기·그림 검사 한 묶음. 25장이던 10-20 첫 실행은 Gemini Flash 가 5분 시간 초과 3번 → 그린 19장을 못 올리고 멈췄다.
// 묶음이 작으면 판정이 가볍고, 검사 AI 가 막혀도 헛그림이 묶음 하나뿐. Flash 무료 몫(하루 ≈20번) 안: 80 ÷ 10 = 8번 + 다시 그린 것 판정
const BATCH = 10;
// 검사 대기(검사 AI 가 막혀 못 올린 그림) 상한. 이만큼 쌓이면 그리기를 멈춘다 — 검사 AI 가 며칠 막혀도 무한히 쌓이지 않게. 하루 그리기 상한과 같은 80
const PENDING_MAX = Number(process.env.DAILY_PENDING_MAX) || 80;
// 자동 검사·판정에서 떨어진 그림(근거용, 장당 수십 KB). 깃허브 실행이면 daily.yml 이 artifact 로 올린다. .data 는 git 제외
const REJECT_DIR = path.join(ROOT, '.data', 'rejected');
const DRY = process.argv.includes('--dry');
const NO_IMAGE = process.argv.includes('--no-image');
const NO_TEXT = process.argv.includes('--no-text');
const NO_JUDGE = process.argv.includes('--no-judge');
// 이미 올라간 그림을 전부 다시 검사(손 실행, daily.yml 의 recheck) — 탈락은 다시 그리기 목록 맨 앞에
const RECHECK = process.argv.includes('--recheck');

const REDO = (process.argv.find((a) => a.startsWith('--redo=')) || '').slice(7).split(',').filter(Boolean);
// Worker 는 2,000자까지 받음. 고정 문장(그림체·보르티·참고 그림) ≈ 900자 + 장면 ≈ 250자
const PROMPT_MAX = 1300;
// 그림체를 바꾼 뒤 예전 그림 id 목록(PC 에만, git 제외). 그림 없는 새 단어보다 먼저 다시 그리고, 다 그리면 빈다
const RESTYLE_FILE = path.join(ROOT, '.data', 'restyle.json');
// 그릴 단어가 다 떨어져 「전부 완료」 알림을 보낸 표시(새 단어가 생기면 지움 → 다시 끝나면 또 알림)
const DONE_FILE = path.join(ROOT, '.data', 'images-done.json');
// 검사용 원본(올리기 전)·뜻 검사 모음 그림. git 제외 폴더
const TMP_DIR = path.join(ROOT, '.data', 'img-tmp');
// 장면이 앞, 보르티 설명이 뒤. 장면을 뒤에 두었더니 마스코트만 크게 나오고 뜻이 안 보였다(2026-10-13 사용자 지적).
function imagePrompt(scene, withRef) {
  const tail = ` ${BORTI} Other animals in the same style. ${STYLE}`;
  const head = `${STYLE_INTRO} ${withRef ? REF_NOTE + ' ' : ''}Scene: `;
  let sc = scene.trim();
  const room = PROMPT_MAX - head.length - tail.length;
  if (sc.length > room) sc = sc.slice(0, room).replace(/[,;]?\s+\S*$/, '') + '.';
  return head + sc + tail;
}

const log = { day: kstDay(), started: new Date().toISOString(), text: 0, images: [], failed: [], quota: null, pending: { before: 0, sent: 0, uploaded: 0, rejected: 0, dropped: 0, left: 0 }, rejected_saved: 0 };

try {
  if (!APP_URL || !TOKEN) throw new Error('.env 에 APP_URL · API_TOKEN 이 없다');

  // 1) 글 채우기
  if (!NO_TEXT) {
    const runway = await api(`/api/admin/runway?text=${TEXT_AHEAD}&image=0`);
    if (runway.need_text.length) {
      // AI 가 실패해도(무료 몫 429 등) 그림은 그린다 — 예전에는 여기서 그날 작업 전체가 멈췄다
      try {
        const items = await writeText(runway.need_text);
        if (items.length && !DRY) {
          const r = await api('/api/admin/words', { method: 'POST', body: { items } });
          log.text = r.updated;
        } else log.text = items.length;
        console.log(`글 채움 ${items.length}/${runway.need_text.length}`);
      } catch (e) {
        log.text_error = String(e.message || e).slice(0, 300);
        console.error(`글 채우기 실패 — 그림은 계속: ${log.text_error}`);
        await notify('error', 'Wortling 글 채우기 실패', log.text_error);
      }
    } else console.log('글 채울 단어 없음');
  }

  // 2) 그림 만들기
  if (!NO_IMAGE) {
    const budget = IMAGE_MAX;
    let quotaOut = false; // 무료 하루 몫을 다 씀(429)
    // 그릴 차례(기획안 v7 C4). --redo 면 그것만. 아니면
    //   ① 예전 그림체 목록 .data/restyle.json
    //   ② 그림 없는 단어(공부 중인 카드 먼저, 그다음 학습 순서 = 오늘 덱의 새 카드가 맨 앞)
    // 오늘 덱을 따로 앞세우던 단계는 뺐다 — ②와 같은 순서인데 검사 탈락(failed) 단어까지 매일 다시 그렸다
    const restyle = existsSync(RESTYLE_FILE) ? JSON.parse(readFileSync(RESTYLE_FILE, 'utf8')) : [];
    const saveRestyle = () => writeFileSync(RESTYLE_FILE, JSON.stringify(restyle));
    // 2026-10-19 사용자 「강아지 다리 5개 같은 오류」 — 판정에 몸 구조를 넣기 전에 올라간 그림을 같은 판정으로 다시 본다.
    // 탈락은 곧바로 그림을 내리고(failed = 머리글자 칸, 결함 그림을 보이지 않게) restyle 맨 앞 → 오늘(몫이 남으면)·다음 날 먼저 다시 그린다.
    // 다시 그려도 두 번 탈락하면 머리글자 칸으로 남는다. 판정이 준 고친 장면(단순한 자세)은 fix 에 두었다가 그날 첫 그리기에 쓴다
    const fix = new Map();
    // 그림 검사 AI(Flash 무료 몫)를 못 씀 → 검사 없이는 올리지 않는다. 그래도 그날 몫까지는 그리고, 자동 검사를 통과한 그림은 「검사 대기」로 맡겨 다음 실행이 먼저 검사한다
    let judgeDown = false;
    if (RECHECK && !REDO.length) {
      // 질의 한 번. /api/words 를 43쪽 넘기던 때는 한 번에 D1 행 읽기 ≈130만 → 하루 무료 5M 을 넘겼다(2026-10-19)
      const have = (await api('/api/admin/images')).items;
      const bad = [];
      let judged = 0;
      for (let i = 0; i < have.length; i += BATCH) {
        const items = [];
        for (const w of have.slice(i, i + BATCH)) {
          try {
            const res = await fetch(`${APP_URL}/img/${w.id}.webp`);
            if (res.ok) items.push({ id: w.id, word: `${w.gender ? w.gender + ' ' : ''}${w.lemma}`, meaning_ko: w.gloss_ko, png: Buffer.from(await res.arrayBuffer()) });
          } catch { /* 한 장 못 받으면 그 장만 건너뜀 */ }
        }
        const v = await judgeImages(items);
        if (!v) {
          judgeDown = true; // 그리기 첫 묶음을 그린 뒤에야 알면 그 묶음 그림 몫을 헛쓴다
          console.log('다시 검사 멈춤 — 그림 검사 AI 를 못 씀(남은 그림은 다음에, 오늘 그린 그림은 판정 없이 검사 대기로)');
          break;
        }
        judged += v.size;
        for (const it of items) {
          const x = v.get(it.id);
          if (x?.ok !== false) continue;
          bad.push(it.id);
          if (x.scene) fix.set(it.id, x.scene);
          console.log(`다시 검사 탈락 ${it.id} ${it.word}: ${x.why}`);
          if (!DRY) await saveRejected(it.id, 'recheck', x.why, it.png);
          if (!DRY) await api(`/api/admin/image/${it.id}?status=failed`, { method: 'PUT' }).catch((e) => console.error(String(e.message).slice(0, 200)));
        }
      }
      for (const id of bad.reverse()) if (!restyle.includes(id)) restyle.unshift(id);
      if (!DRY) saveRestyle();
      log.recheck = { images: have.length, judged, bad: bad.length };
      console.log(`다시 검사 ${judged}/${have.length}장 · 탈락 ${bad.length}장 → 다시 그리기 목록 맨 앞`);
    }
    // 검사 대기 그림부터(2026-10-26 기획 G1) — 어제 검사 AI 가 막혀 맡긴 그림. 통과면 올리고, 탈락이면 고친 장면으로 오늘 첫 그리기
    const pend = await processPending({
      api,
      judge: NO_JUDGE ? async (items) => new Map(items.map((it) => [it.id, { ok: true }])) : judgeImages,
      batch: BATCH,
      wantsNew: (id) => REDO.includes(id) || restyle.includes(id),
      saveRejected: (...a) => (DRY ? undefined : saveRejected(...a)),
      dry: DRY,
    });
    const holdOk = !pend.unavailable; // 대기 길이 안 열리면(Worker 가 옛 판) 예전처럼 검사 못 한 그림은 올리지 않고 내일 다시
    let pendingTotal = pend.left.size; // 대기에 남은 장수(오늘 맡긴 것도 더한다)
    let inflight = 0; // 이번 묶음에서 그렸고 곧 대기로 갈 장수(검사 AI 가 막힌 줄 알 때만) — 상한을 묶음 중간에도 지키려고
    if (pend.judgeDown) judgeDown = true;
    for (const [id, sc] of pend.fix) fix.set(id, sc);
    for (const id of pend.uploaded) if (restyle.includes(id)) restyle.splice(restyle.indexOf(id), 1);
    for (const id of pend.gaveUp) {
      // 고친 장면 없이 탈락 — 다시 그리기 탈락과 같은 규칙: 새 단어만 실패 표시, 예전 그림체 목록이면 예전 그림을 두고 목록에서 뺌
      if (!REDO.includes(id) && !restyle.includes(id)) await api(`/api/admin/image/${id}?status=failed`, { method: 'PUT' }).catch((e) => console.error(String(e.message).slice(0, 200)));
      if (restyle.includes(id)) {
        restyle.splice(restyle.indexOf(id), 1);
        (log.restyle_gave_up ??= []).push(id);
      }
    }
    if (!DRY) saveRestyle();
    Object.assign(log.pending, { before: pend.total, uploaded: pend.uploaded.length, rejected: pend.rejected.length, dropped: pend.dropped.length });
    const redo = new Set(REDO.length ? REDO : restyle);
    const ids = [];
    // 대기에 있는 단어는 다시 그리지 않는다(그리기 몫 이중 사용)
    const add = (list) => {
      for (const id of list) if (ids.length < budget && !ids.includes(id) && !pend.left.has(id)) ids.push(id);
    };
    if (REDO.length) add(REDO);
    else if (budget > 0) {
      add(pend.front);
      add(restyle);
      if (budget > ids.length) add((await api(`/api/admin/runway?text=0&image=${budget - ids.length + 5 + pend.left.size}`)).need_image.map((w) => w.id));
    }
    if (DRY) console.log(`[dry] 그릴 차례(다시 그리기 ${ids.filter((id) => redo.has(id)).length}): ${ids.join(',')}`);
    const need = [];
    for (const id of ids) {
      let d;
      try {
        d = await api(`/api/word/${id}`);
      } catch (e) {
        if (/→ 404/.test(String(e.message))) continue; // 카드 행이 없는 단어는 건너뜀
        throw e;
      }
      need.push({ ...d.word, scene_en: d.scene_en }); // 새 장면을 못 쓰면 이 장면으로
    }
    console.log(`오늘 그림 ${need.length}장(상한 ${budget})`);
    mkdirSync(TMP_DIR, { recursive: true });
    // 참고 그림(보르티 생김새 고정). Worker 가 못 받으면 그날은 없이 그린다
    let ref = existsSync(REF_FILE) ? readFileSync(REF_FILE).toString('base64') : null;
    let refWorked = false; // 오늘 참고 그림으로 한 장이라도 그려졌나(끊긴 뒤 그린 그림을 다시 그릴지 가름)
    const drawOnce = async (scene) => {
      const gen = async () => {
        const p = await api('/api/admin/draw', { method: 'POST', body: { prompt: imagePrompt(scene, !!ref), width: 1024, height: 768, ...(ref ? { ref } : {}) }, bin: true });
        if (ref) refWorked = true;
        return p;
      };
      try {
        return await gen();
      } catch (e) {
        // 생성 실패면 5초 뒤 한 번 더. 무료 몫을 다 쓰면(429) 다시 요청하지 않고 그대로 던진다
        if (/→ 429/.test(String(e.message))) throw e;
        console.error(`다시 요청: ${String(e.message || e).slice(0, 120)}`);
        await new Promise((r) => setTimeout(r, 5000));
        try {
          return await gen();
        } catch (e2) {
          if (!ref || /→ 429/.test(String(e2.message))) throw e2;
          log.ref_error = String(e2.message || e2).slice(0, 200);
          console.error(`참고 그림 없이 다시: ${log.ref_error}`);
          ref = null;
          return gen();
        }
      }
    };
    let checked = 0;
    const utcDay = new Date().toISOString().slice(0, 10);
    let drawnBefore = 0; // 오늘 앞선 실행이 그린 횟수
    try {
      const d = JSON.parse(readFileSync(DRAW_DAY_FILE, 'utf8'));
      if (d.day === utcDay) drawnBefore = Number(d.drawn) || 0;
    } catch { /* 없으면 0 */ }
    // 한 번 그릴 때마다 적어 둔다 — 도중에 죽어도 다음 실행이 쓴 몫을 안다
    const saveDrawDay = () => { if (!DRY) writeFileSync(DRAW_DAY_FILE, JSON.stringify({ day: utcDay, drawn: drawnBefore + checked })); };
    if (drawnBefore) console.log(`오늘(UTC) 앞선 실행이 ${drawnBefore}번 그림 — 남은 몫 ${Math.max(0, DRAW_MAX - drawnBefore)}번`);
    let ocrSkipped = 0;
    let errStreak = 0; // 단어 탓이 아닌 오류(용량 부족·서버 오류)가 잇따르면 그날은 멈춤
    // 그리기 상한에 닿으면 남은 단어·뜻 탈락 다시 그리기는 내일로(실패 표시 안 함)
    // UTC 자정을 넘기면 멈춤 — 그 뒤 그림은 새 날 몫인데 파일엔 옛 날로 적혀 다음 실행이 또 80번 그린다
    // 검사 AI 가 막혔어도(judgeDown) 그리기는 계속한다 — 대기가 상한(PENDING_MAX)에 닿거나 대기 길이 없을 때만 멈춤
    const stopped = () => quotaOut || (judgeDown && !holdOk) || pendingTotal + inflight >= PENDING_MAX || errStreak >= 3 || drawnBefore + checked >= DRAW_MAX || new Date().toISOString().slice(0, 10) !== utcDay;
    // 한 단어 그리기 + 자동 검사(C5). 탈락이면 한 번만 다시. → {png, check, why} · 그리기 오류면 null(실패 표시 안 함, 내일 다시)
    const drawChecked = async (w, scene) => {
      let png = null, check = null, why = [];
      try {
        for (let attempt = 1; attempt <= 2 && !png; attempt++) {
          const p = await drawOnce(scene);
          checked++;
          saveDrawDay();
          // 실측: 가끔 새까만 그림이 온다(w0010, 편차 0)
          const { channels } = await sharp(p).stats();
          if (channels.every((c) => c.stdev < 4)) { why = ['blank_image']; continue; }
          const tmp = path.join(TMP_DIR, `${w.id}-${attempt}.jpg`);
          writeFileSync(tmp, p);
          check = await checkFile(tmp, p);
          try { unlinkSync(tmp); } catch { /* 지우기 실패는 무시 */ }
          if (check.chars === null) ocrSkipped++;
          if (check.ok) png = p;
          else {
            why = check.why;
            console.log(`그림 ${w.id} ${w.lemma} 검사 탈락(${why.join(', ')})${attempt === 1 ? ' → 한 번 더' : ''}`);
            await saveRejected(w.id, 'check', why.join('+'), p);
          }
        }
      } catch (e) {
        quotaOut = /→ 429/.test(String(e.message));
        if (quotaOut) { log.quota = 'out'; return null; }
        log.failed.push({ id: w.id, error: String(e.message || e).slice(0, 300) });
        errStreak++;
        return null;
      }
      errStreak = 0;
      return { png, check, why };
    };
    const toJudge = (d) => ({ id: d.w.id, word: `${d.w.gender ? d.w.gender + ' ' : ''}${d.w.lemma}`, meaning_ko: d.w.gloss_ko, png: d.png });
    log.meaning = { judged: 0, retried: 0, failed: 0 };

    // BATCH 단어씩: 장면 쓰기(AI) → 그리기 → 뜻 검사(AI) → 탈락은 고친 장면으로 한 번 더 → 올리기.
    // 장면은 그리기 직전에 묶음마다 — 무료 몫이 바닥이면 헛쓰는 장면이 한 묶음뿐
    for (let i = 0; i < need.length && !stopped(); i += BATCH) {
      const batch = need.slice(i, i + BATCH);
      // --dry 도 장면은 써 본다(저장·그리기는 안 함) → 장면 규칙 점검용
      const briefs = await writeScenes(batch);
      for (const w of batch) if (fix.has(w.id)) briefs.set(w.id, fix.get(w.id)); // 다시 검사가 준 몸 구조용 장면이 먼저
      if (briefs.size && !DRY) await api('/api/admin/words', { method: 'POST', body: { items: [...briefs].map(([id, scene_en]) => ({ id, scene_en })) } });
      console.log(`새 장면 ${briefs.size}/${batch.length}`);
      const done = [];
      for (const w of batch) {
        if (stopped()) break;
        const scene = briefs.get(w.id) || w.scene_en;
        if (!scene) continue;
        if (DRY) { console.log(`[dry] ${w.id} ${w.lemma}: ${scene}`); continue; }
        const t0 = Date.now();
        const r = await drawChecked(w, scene);
        if (r) done.push({ w, scene, t0, ...r });
        if (judgeDown && !NO_JUDGE) inflight = done.filter((d) => d.png).length;
      }
      // 그림 검사 = 뜻(2026-10-14 사용자 「그림이 단어 뜻과 안 이어진다」) + 몸 구조(2026-10-19 「다리 5개」).
      // AI 가 판정을 못 하면(null) 예전엔 통과였다 → 검사 없이 올리면 안 되니 그 그림은 「검사 대기」로 맡긴다(다음 실행이 먼저 검사).
      // 판정은 왔는데 그 그림만 빠진 것(모델이 n 을 빠뜨림)도 검사 안 된 그림이라 같다. 막혔다는 걸 안 뒤로는 판정을 부르지 않고(헛 호출·재시도 대기) 자동 검사 통과분을 곧장 대기로
      // 대기 길이 없으면(holdOk 아님) 예전처럼 올리지 않고 내일 다시(defer) + 그날 그리기도 멈춤
      const hold = (list) => {
        if (!list.length) return;
        for (const d of list) {
          if (holdOk) d.hold = true;
          else { d.png = null; d.defer = true; }
        }
        log.meaning.unjudged = (log.meaning.unjudged ?? 0) + list.length;
        console.log(`그림 검사 못 받음 — ${list.length}장은 ${holdOk ? '검사 대기로 맡김' : '올리지 않고 내일 다시'}`);
      };
      if (!NO_JUDGE) {
        const first = done.filter((d) => d.png);
        let again = [];
        if (judgeDown) hold(first);
        else {
          const v1 = await judgeImages(first.map(toJudge));
          const s1 = sortByVerdict(first, v1);
          if (s1.down) judgeDown = true;
          hold(s1.hold);
          log.meaning.judged += v1?.size ?? 0;
          again = s1.reject;
          for (const d of again) {
            const v = v1.get(d.w.id);
            console.log(`그림 ${d.w.id} ${d.w.lemma} 뜻 탈락(${v.why}) → 고친 장면으로 한 번 더`);
            await saveRejected(d.w.id, 'meaning', v.why, d.png);
            d.png = null;
            d.why = [`meaning: ${v.why}`];
            // 몫 소진·서버 오류로 다시 그리지 못하면 단어 탓이 아니니 내일 다시(실패 표시 안 함)
            if (stopped()) { d.defer = true; continue; }
            if (!v.scene) continue;
            log.meaning.retried++;
            const r = await drawChecked(d.w, v.scene);
            if (!r) d.defer = true;
            else if (r.png) Object.assign(d, { png: r.png, check: r.check, scene: v.scene, rescene: true, pending: true });
          }
        }
        const redrawn = again.filter((d) => d.pending);
        if (judgeDown) hold(redrawn);
        else if (redrawn.length) {
          const v2 = await judgeImages(redrawn.map(toJudge));
          const s2 = sortByVerdict(redrawn, v2);
          if (s2.down) judgeDown = true;
          hold(s2.hold);
          for (const d of s2.reject) {
            const v = v2.get(d.w.id);
            await saveRejected(d.w.id, 'meaning', v.why, d.png);
            d.png = null;
            d.why = [`meaning: ${v.why}`];
          }
        }
        for (const d of redrawn) d.pending = false;
      }
      // 검사 대기로 맡길 그림(고친 장면으로 다시 그린 것이면 장면도 그것으로 — 그림·장면이 같은 것을 가리키게)
      for (const d of done.filter((x) => x.hold && x.png)) {
        const { w } = d;
        try {
          await api(`/api/admin/pending/${w.id}`, { method: 'PUT', raw: await toWebp(d.png), headers: { 'content-type': 'image/webp' } });
        } catch (e) {
          log.failed.push({ id: w.id, error: `pending: ${String(e.message || e).slice(0, 200)}` });
          d.png = null; d.defer = true; d.hold = false; // 맡기지 못한 그림은 버림 — 내일 다시
          continue;
        }
        pendingTotal++;
        log.pending.sent++;
        if (d.rescene) await api('/api/admin/words', { method: 'POST', body: { items: [{ id: w.id, scene_en: d.scene }] } }).catch((e) => console.error(String(e.message).slice(0, 200)));
        console.log(`그림 ${w.id} ${w.lemma} 검사 대기로 맡김(대기 ${pendingTotal}장)`);
      }
      inflight = 0;
      for (const d of done) {
        const { w } = d;
        if (d.hold && d.png) continue; // 위에서 검사 대기로 맡김
        if (!d.png) {
          if (d.defer) continue;
          if (d.why?.[0]?.startsWith('meaning')) log.meaning.failed++;
          log.failed.push({ id: w.id, error: d.why?.join(', ') || 'no_image', check: d.check });
          // 다시 그리기면 있던 그림을 지킨다. 새 단어만 실패 표시(머리글자 칸)
          if (!redo.has(w.id)) await api(`/api/admin/image/${w.id}?status=failed`, { method: 'PUT' }).catch((e) => console.error(String(e.message).slice(0, 200)));
          // 예전 그림체 목록에서 탈락하면 예전 그림을 두고 목록에서 뺀다 — 같은 단어에 매일 그리기 몫을 쓰지 않게
          if (restyle.includes(w.id)) {
            restyle.splice(restyle.indexOf(w.id), 1);
            saveRestyle();
            (log.restyle_gave_up ??= []).push(w.id);
          }
          continue;
        }
        const webp = await toWebp(d.png);
        try {
          await api(`/api/admin/image/${w.id}`, { method: 'PUT', raw: webp, headers: { 'content-type': 'image/webp' } });
        } catch (e) {
          // 올리기 하나가 실패해도 나머지는 계속
          log.failed.push({ id: w.id, error: `upload: ${String(e.message || e).slice(0, 200)}` });
          continue;
        }
        // 뜻 검사가 고친 장면으로 그렸으면 장면도 그것으로(그림·장면이 같은 것을 가리키게). 실패해도 그림은 올라갔으니 계속
        if (d.rescene) await api('/api/admin/words', { method: 'POST', body: { items: [{ id: w.id, scene_en: d.scene }] } }).catch((e) => console.error(String(e.message).slice(0, 200)));
        if (restyle.includes(w.id)) restyle.splice(restyle.indexOf(w.id), 1);
        // 참고 그림이 중간에 끊긴 뒤 그린 그림은 생김새가 다를 수 있어 나중에 다시 그리게 목록에 둔다.
        // 처음부터 안 먹힌 날은 넣지 않는다(매일 같은 단어만 다시 그리며 새 단어가 막히지 않게)
        if (!ref && refWorked) restyle.push(w.id);
        saveRestyle();
        const { edgeWhite, top4, black, chars } = d.check;
        log.images.push({ id: w.id, lemma: w.lemma, kb: +(webp.length / 1024).toFixed(1), sec: +((Date.now() - d.t0) / 1000).toFixed(1), rescene: !!d.rescene, check: { edgeWhite, top4, black, chars } });
        console.log(`그림 ${w.id} ${w.lemma} ${(webp.length / 1024).toFixed(1)}KB ${((Date.now() - d.t0) / 1000).toFixed(0)}초${d.rescene ? ' (고친 장면)' : ''}`);
      }
    }
    // G15: 검사 통과율(생성 1번 = 1건)
    log.checks = { drawn: checked, drawn_before: drawnBefore, draw_max: DRAW_MAX, passed: log.images.length, rate: checked ? +(log.images.length / checked).toFixed(2) : null, ocr_skipped: ocrSkipped, ref: !!ref };
    // 뉴런 어림 — 대시보드 실측 한 장 ≈ 109(계산 83.4 의 1.3배, 2026-10-19). 실패 요청은 안 셈
    log.neurons_est = Math.round(checked * 109);

    // 진행률 · 전부 완료 알림(그릴 단어가 하나도 안 남은 첫날 한 번)
    // 남은 것 = 그림 없는 단어 + 글(장면)이 아직 빈 단어 + 예전 그림체 목록. 이 블록이 실패해도 백업은 한다
    if (!DRY && !REDO.length) {
      try {
        const st = await api('/api/stats');
        const rw = await api('/api/admin/runway?text=1&image=1');
        const left = rw.need_image.length + rw.need_text.length + restyle.length;
        log.progress = { images: st.images, words: st.total_words, left_any: left > 0 };
        console.log(`그림 진행 ${st.images}/${st.total_words}`);
        if (left === 0 && !existsSync(DONE_FILE)) {
          const sent = await notify('done', 'Wortling 카드 그림 전부 완료', `그림 ${st.images}/${st.total_words}장(나머지는 검사 탈락 표시). 새 단어가 들어오면 매일 작업이 이어서 그린다.`);
          if (sent) writeFileSync(DONE_FILE, JSON.stringify({ day: log.day, images: st.images, words: st.total_words }));
        } else if (left > 0 && existsSync(DONE_FILE)) unlinkSync(DONE_FILE);
      } catch (e) {
        log.progress_error = String(e.message || e).slice(0, 200);
      }
    }

    // 막힘 알림(2026-10-26 G3) — 한 실행에 한 통. 검사 못 해 대기로 맡긴 그림이 생겼거나, 대기에서 검사 AI 가 계속 막혔거나,
    // 그림을 그렸는데 올린 그림이 0장이면. 예전엔 0장 올린 날도 Actions 는 success 에 알림도 없었다(10-21~25 나흘)
    log.pending.left = pendingTotal;
    console.log(`검사 대기 ${pendingTotal}장(이번에 맡김 ${log.pending.sent} · 대기에서 올림 ${log.pending.uploaded} · 탈락 ${log.pending.rejected} · 정리 ${log.pending.dropped})`);
    const uploadedToday = log.images.length + log.pending.uploaded;
    const blocked = log.pending.sent > 0 || (judgeDown && pendingTotal > 0);
    if (!DRY && (blocked || (checked > 0 && uploadedToday === 0))) {
      const head = `대기 ${pendingTotal}장 · 오늘 올림 ${uploadedToday}장`;
      await notify('error', blocked ? 'Wortling 그림 검사 막힘' : 'Wortling 오늘 올린 그림 0장', blocked ? `${head} · 다음 실행에서 먼저 검사` : `${head} · 그린 ${checked}번 모두 검사 탈락·실패(Actions 의 rejected 그림 확인)`);
    }
  }

  // 3) D1 백업 — PC 의 wrangler 로그인으로 내려받아 backup/ 에 30개 보관(공개 저장소엔 올리지 않음)
  if (!DRY && !process.argv.includes('--no-backup')) {
    try {
      const dir = path.join(ROOT, 'backup');
      mkdirSync(dir, { recursive: true });
      const sql = path.join(dir, `${log.day}.sql`);
      const args = [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'export', 'wortling', '--remote', `--output=${sql}`];
      // 로그인 토큰이 만료돼 이 실행 안에서 갱신되면 갓 받은 토큰이 바로 안 먹혀 「Authentication error [code: 10000]」 (10-15 12:00, 3분 뒤 같은 명령은 됨) → 15초 뒤 1번 더
      for (let i = 0; ; i++) {
        try {
          execFileSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 5 * 60 * 1000, windowsHide: true });
          break;
        } catch (e) {
          // wrangler 오류 = 「✘ [ERROR] …」 줄 + 다음 줄 코드
          const lines = String(e.stderr || e.message).replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          const at = lines.findIndex((s) => s.includes('[ERROR]'));
          const why = (at < 0 ? lines.slice(-2) : lines.slice(at, at + 2)).join(' / ');
          if (i) throw new Error(why);
          console.error(`백업 재시도: ${why}`);
          await new Promise((r) => setTimeout(r, 15000));
        }
      }
      writeFileSync(`${sql}.gz`, gzipSync(readFileSync(sql)));
      unlinkSync(sql);
      const old = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(f)).sort().slice(0, -30);
      for (const f of old) unlinkSync(path.join(dir, f));
      log.backup = `${log.day}.sql.gz`;
      console.log(`백업 backup/${log.backup}`);
    } catch (e) {
      log.backup_error = String(e.message || e).slice(0, 300);
      await notify('error', 'Wortling 백업 실패', `${log.backup_error}\n→ PC 에서 npx wrangler login 다시`);
    }
  }
} catch (e) {
  log.error = String(e.stack || e);
  console.error(log.error);
  await notify('error', `Wortling 매일 작업 실패`, String(e.message || e).slice(0, 500));
  process.exitCode = 1;
} finally {
  log.finished = new Date().toISOString();
  const dir = path.join(ROOT, 'backup', 'daily');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${log.day}.json`), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ text: log.text, images: log.images.length, failed: log.failed.length, quota: log.quota, meaning: log.meaning, pending: log.pending, progress: log.progress, neurons_est: log.neurons_est }));
}

// ── AI(Gemini)로 글 채우기 ──────────────────────────────────────────────
async function writeText(words) {
  const list = words.map((w) => ({ id: w.id, lemma: w.lemma, pos: w.pos, gender: w.gender, level: w.level, gloss_en: w.gloss_en }));
  const prompt = `You write Korean learning content for German vocabulary (learner: Korean speaker, level B1~B2). For EACH item below return one object:
{"id": "<same id>", "gloss_ko": "짧은 한국어 뜻 1~3개, 쉼표 구분, 20자 이내(명사는 관사 없이 명사형, 동사는 ~하다 형)", "example_de": "B1~B2 수준의 자연스러운 독일어 예문 1문장, 70자 이내, 표제어(활용형 가능) 포함", "example_ko": "예문의 자연스러운 한국어 번역, 40자 이내, ~해요체", "scene_en": "ONE English line (max 25 words) starting with 'Borti ' — a concrete visual scene where the mascot Borti (a chubby white puppy with tan floppy ears) acts out the word's meaning with ONE concrete prop or action; no text, letters, numbers, signs or logos; only Borti unless a second character is required"}
Output ONLY a JSON array (no prose, no code fence) with exactly ${list.length} objects in the same order.
Items: ${JSON.stringify(list)}`;
  const arr = await askJson(prompt);
  const ids = new Set(list.map((w) => w.id));
  const items = [];
  for (const o of arr) {
    if (!o || !ids.has(o.id)) continue;
    const it = { id: o.id };
    if (typeof o.gloss_ko === 'string' && o.gloss_ko.trim()) it.gloss_ko = o.gloss_ko.trim().slice(0, 40);
    if (typeof o.example_de === 'string' && o.example_de.trim() && o.example_de.length <= 90) {
      it.example_de = o.example_de.trim();
      if (typeof o.example_ko === 'string' && o.example_ko.trim()) it.example_ko = o.example_ko.trim().slice(0, 80);
    }
    if (typeof o.scene_en === 'string' && /^Borti /.test(o.scene_en.trim())) it.scene_en = o.scene_en.trim().slice(0, 300);
    if (Object.keys(it).length > 1) items.push(it);
  }
  return items;
}

// ── AI(Gemini)로 그림 장면 쓰기 ─────────────────────────────────────────────
// 2026-10-14 실측(35장 검토): 장면에 장소 + 소품 3개 + 조연까지 넣으면 4b 모델이 소품을 빼먹고 보르티만 크게 그려
// 뜻 단서가 사라졌다(los 의 기차 · verschwinden 의 빈 열쇠걸이 · einzig 의 무리 · Entscheidung 의 갈림길). → 짧게, 뜻을 맡은 물건 하나를 맨 앞에.
// 2026-10-16 사용자 「그림이 예문 장면이 됨 — 단어 자체를 그려야」 → 예문은 넘기지 않고 단어·품사·뜻만으로 장면을 쓴다.
async function writeScenes(words) {
  const list = words.map((w) => ({ id: w.id, word: `${w.gender ? w.gender + ' ' : ''}${w.lemma}`, pos: w.pos, meaning_ko: w.gloss_ko }));
  const prompt = `You write image scenes for German vocabulary flashcards. Each card shows the German word, its Korean meaning and a simple doodle. The doodle illustrates the WORD ITSELF — its core dictionary meaning, the way a picture dictionary would — never a particular sentence or story. A small image model draws the scene and drops details, so keep it SIMPLE: one glance at the picture must say the word.
Rules for each scene (ONE English line, max 28 words and 180 characters, start with "Borti"):
- Borti (a chubby white puppy) shows the word; when the word has several meanings, draw the first Korean meaning.
- Begin with the key: the ONE object or action that stands for the word, drawn large.
  · noun → the thing itself, big and centered, in its most typical form or use (Kühlschrank: Borti opens a big fridge full of food).
  · verb → the action at its most unmistakable moment (springen: Borti mid-air, jumping over a puddle).
  · adjective → exaggerate the quality, add a contrasting opposite if it helps (eng: Borti squeezing through a very narrow gap).
  · abstract word (adverb, conjunction, particle, pronoun, idea) → the most typical everyday situation that shows the concept itself, with ONE clear prop, plus a symbol and Borti's expression (wieso: Borti frowning, a big question mark above his head; Zukunft: Borti looking ahead along a path toward a rising sun).
- At most 2 props and at most one other character (a puppy or kitten), only if the meaning needs them. Place = one word at most (kitchen, platform), no landscape.
- A symbol (? ! heart, sweat drop, motion lines, arrow) only when it carries the meaning (? = asking or doubt, ! = urgency or surprise), at most one; no decorative sparkles. No text, letters, numbers, signs, logos, screens with writing or speech bubbles.
Output ONLY a JSON array [{"id": "...", "scene_en": "..."}] with exactly ${list.length} items in the same order. No prose, no code fence.
Items: ${JSON.stringify(list)}`;
  const out = new Map();
  try {
    const arr = await askJson(prompt);
    const ids = new Set(list.map((w) => w.id));
    // 「Borti」로 시작하라 했지만 「In a kitchen, Borti …」 처럼 와도 받는다
    for (const o of arr) if (ids.has(o?.id) && typeof o.scene_en === 'string' && /\bBorti\b/.test(o.scene_en)) out.set(o.id, o.scene_en.trim().slice(0, 300));
    if (out.size < list.length) console.error(`장면 ${list.length}개 중 ${out.size}개만 받음(나머지는 예전 장면) — 받은 원문 ${arr.length}개: ${JSON.stringify(arr).slice(0, 300)}`);
  } catch (e) {
    console.error(`장면 쓰기 실패 — 예전 장면으로 그림: ${String(e.message || e).slice(0, 200)}`);
  }
  return out;
}

/** 탈락 그림을 .data/rejected/<단어 id>_<어디서>_<사유>.webp 로 남긴다(작게). 저장 실패는 무시 — 근거 남기기가 매일 작업을 막으면 안 된다 */
async function saveRejected(id, kind, why, buf) {
  try {
    mkdirSync(REJECT_DIR, { recursive: true });
    const slug = String(why).replace(/[^\p{L}\p{N}.+_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'x';
    let n = 0;
    let file;
    do file = path.join(REJECT_DIR, `${id}_${kind}_${slug}${n ? `_${n}` : ''}.webp`); while (existsSync(file) && ++n);
    writeFileSync(file, await toWebp(buf));
    log.rejected_saved++;
  } catch (e) {
    console.error(`탈락 그림 저장 실패 ${id}: ${String(e.message || e).slice(0, 120)}`);
  }
}

async function toWebp(png) {
  for (const quality of [82, 70, 60, 50]) {
    const buf = await sharp(png).resize(640, 480, { fit: 'cover' }).webp({ quality }).toBuffer();
    if (buf.length <= 60 * 1024) return buf; // 게이트 G8′: webp ≤ 60KB
  }
  return sharp(png).resize(640, 480, { fit: 'cover' }).webp({ quality: 45 }).toBuffer();
}

// ── Worker 관리 API ──────────────────────────────────────────────────────
async function api(p, { method = 'GET', body, raw, headers = {}, bin = false } = {}) {
  const init = {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  };
  let res;
  try {
    res = await fetch(APP_URL + p, init);
  } catch (e) {
    // AI 를 기다리는 사이 서버가 묵은 연결을 닫으면 「fetch failed」 → 한 번 다시
    console.error(`재시도 ${method} ${p}: ${e.cause?.code || e.message}`);
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(APP_URL + p, init);
  }
  if (bin && res.ok) return Buffer.from(await res.arrayBuffer());
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ── 잡동사니 ──────────────────────────────────────────────────────────────
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
function kstDay(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
/** 디스코드 알림. PC 면 AI_CLI 알리미, 깃허브 서버면 DISCORD_WEBHOOK_URL 로 바로. 보냈으면 true */
async function notify(type, title, desc) {
  const notifier = 'C:/Users/cgpar/AI_CLI/scripts/discord-notify.js';
  if (existsSync(notifier)) {
    const r = spawnSync(process.execPath, [notifier, 'send'], { input: JSON.stringify({ type, title, desc, cli: 'claude' }), encoding: 'utf8', windowsHide: true, timeout: 20000 });
    return r.status === 0;
  }
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: `**${title}**\n${desc}`.slice(0, 1900) }) });
    return res.ok;
  } catch {
    return false;
  }
}
