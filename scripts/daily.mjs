// 매일 아침 PC 에서 한 번 도는 스크립트(작업 스케줄러 → scripts/register-task.ps1).
// 하는 일 둘:
//   1) 글 채우기 — 다가오는 단어(학습 순서 앞쪽) 가운데 한국어 뜻·예문·장면이 빈 것을 claude -p 로 채운다.
//   2) 그림 만들기 — Worker 의 POST /api/admin/draw(Cloudflare Workers AI FLUX.2 klein 4b, 무료 하루 10,000 뉴런 ≈ 100장)로
//      장면이 있는 단어의 그림을 만들어 올린다. 무료 몫을 다 쓰면 429(quota) → 그날은 멈춤.
//      매일 이어서 그리다가 그릴 단어가 하나도 안 남으면 「전부 완료」 알림을 한 번 보낸다(새 단어가 들어오면 다시 그림).
// Worker 관리 API 만 쓴다(그림은 wrangler 불필요). 준비물: .env(APP_URL · API_TOKEN), claude 로그인.
// 되풀이해도 안전하다 — 이미 채워진 단어·그림은 다시 하지 않는다.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { STYLE_INTRO, BORTI, STYLE, REF_NOTE, REF_FILE } from './style.mjs';
import { checkFile } from './imgcheck.mjs';
import { askJson } from './claude.mjs';
import { judgeImages } from './judge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));

const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || '';
const TEXT_AHEAD = Number(process.env.DAILY_TEXT_AHEAD || 60); // 글을 미리 채워 둘 단어 수
// 하루 그림 상한. 10,000 뉴런 ÷ (그림 78 + 참고 그림 입력) — 뜻 검사 탈락 다시 그리기 몫을 남김. 넘치면 429 로 멈출 뿐
const IMAGE_MAX = Number(process.env.DAILY_IMAGE_MAX || 100);
const DRY = process.argv.includes('--dry');
const NO_IMAGE = process.argv.includes('--no-image');
const NO_TEXT = process.argv.includes('--no-text');
const NO_JUDGE = process.argv.includes('--no-judge');

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

const log = { day: kstDay(), started: new Date().toISOString(), text: 0, images: [], failed: [], quota: null };

try {
  if (!APP_URL || !TOKEN) throw new Error('.env 에 APP_URL · API_TOKEN 이 없다');

  // 1) 글 채우기
  if (!NO_TEXT) {
    const runway = await api(`/api/admin/runway?text=${TEXT_AHEAD}&image=0`);
    if (runway.need_text.length) {
      const items = writeTextWithClaude(runway.need_text);
      if (items.length && !DRY) {
        const r = await api('/api/admin/words', { method: 'POST', body: { items } });
        log.text = r.updated;
      } else log.text = items.length;
      console.log(`글 채움 ${items.length}/${runway.need_text.length}`);
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
    const redo = new Set(REDO.length ? REDO : restyle);
    const ids = [];
    const add = (list) => {
      for (const id of list) if (ids.length < budget && !ids.includes(id)) ids.push(id);
    };
    if (REDO.length) add(REDO);
    else if (budget > 0) {
      add(restyle);
      if (budget > ids.length) add((await api(`/api/admin/runway?text=0&image=${budget - ids.length + 5}`)).need_image.map((w) => w.id));
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
    let ocrSkipped = 0;
    let errStreak = 0; // 단어 탓이 아닌 오류(용량 부족·서버 오류)가 잇따르면 그날은 멈춤
    const stopped = () => quotaOut || errStreak >= 3;
    // 한 단어 그리기 + 자동 검사(C5). 탈락이면 한 번만 다시. → {png, check, why} · 그리기 오류면 null(실패 표시 안 함, 내일 다시)
    const drawChecked = async (w, scene) => {
      let png = null, check = null, why = [];
      try {
        for (let attempt = 1; attempt <= 2 && !png; attempt++) {
          const p = await drawOnce(scene);
          checked++;
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
    const toJudge = (d) => ({ id: d.w.id, word: `${d.w.gender ? d.w.gender + ' ' : ''}${d.w.lemma}`, meaning_ko: d.w.gloss_ko, example_de: d.w.example_de, png: d.png });
    log.meaning = { judged: 0, retried: 0, failed: 0 };

    // 25단어씩: 장면 쓰기(claude) → 그리기 → 뜻 검사(claude) → 탈락은 고친 장면으로 한 번 더 → 올리기.
    // 장면은 그리기 직전에 묶음마다 — 무료 몫이 바닥이면 헛쓰는 장면이 한 묶음뿐
    for (let i = 0; i < need.length && !stopped(); i += 25) {
      const batch = need.slice(i, i + 25);
      // --dry 도 장면은 써 본다(저장·그리기는 안 함) → 장면 규칙 점검용
      const briefs = writeScenesWithClaude(batch);
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
      }
      // 뜻 검사(2026-10-14 사용자 「그림이 단어 뜻과 안 이어진다」). claude 가 실패하면 판정 없음 = 통과
      if (!NO_JUDGE) {
        const v1 = await judgeImages(done.filter((d) => d.png).map(toJudge), TMP_DIR);
        log.meaning.judged += v1.size;
        const again = done.filter((d) => d.png && v1.get(d.w.id)?.ok === false);
        for (const d of again) {
          const v = v1.get(d.w.id);
          console.log(`그림 ${d.w.id} ${d.w.lemma} 뜻 탈락(${v.why}) → 고친 장면으로 한 번 더`);
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
        const v2 = await judgeImages(again.filter((d) => d.pending).map(toJudge), TMP_DIR);
        for (const d of again.filter((x) => x.pending)) {
          d.pending = false;
          const v = v2.get(d.w.id);
          if (v?.ok === false) { d.png = null; d.why = [`meaning: ${v.why}`]; }
        }
      }
      for (const d of done) {
        const { w } = d;
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
    log.checks = { drawn: checked, passed: log.images.length, rate: checked ? +(log.images.length / checked).toFixed(2) : null, ocr_skipped: ocrSkipped, ref: !!ref };
    // 뉴런 어림(1024×768 한 장 ≈ 78 + 참고 그림 입력, 실패 요청은 안 셈)
    log.neurons_est = checked * 78;

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
          const sent = notify('done', 'Wortling 카드 그림 전부 완료', `그림 ${st.images}/${st.total_words}장(나머지는 검사 탈락 표시). 새 단어가 들어오면 매일 작업이 이어서 그린다.`);
          if (sent) writeFileSync(DONE_FILE, JSON.stringify({ day: log.day, images: st.images, words: st.total_words }));
        } else if (left > 0 && existsSync(DONE_FILE)) unlinkSync(DONE_FILE);
      } catch (e) {
        log.progress_error = String(e.message || e).slice(0, 200);
      }
    }
  }

  // 3) D1 백업 — PC 의 wrangler 로그인으로 내려받아 backup/ 에 30개 보관(공개 저장소엔 올리지 않음)
  if (!DRY && !process.argv.includes('--no-backup')) {
    try {
      const dir = path.join(ROOT, 'backup');
      mkdirSync(dir, { recursive: true });
      const sql = path.join(dir, `${log.day}.sql`);
      execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'export', 'wortling', '--remote', `--output=${sql}`], {
        cwd: ROOT, stdio: 'ignore', timeout: 5 * 60 * 1000, windowsHide: true,
      });
      writeFileSync(`${sql}.gz`, gzipSync(readFileSync(sql)));
      unlinkSync(sql);
      const old = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(f)).sort().slice(0, -30);
      for (const f of old) unlinkSync(path.join(dir, f));
      log.backup = `${log.day}.sql.gz`;
      console.log(`백업 backup/${log.backup}`);
    } catch (e) {
      log.backup_error = String(e.message || e).slice(0, 300);
      notify('error', 'Wortling 백업 실패', `${log.backup_error}\n→ PC 에서 npx wrangler login 다시`);
    }
  }
} catch (e) {
  log.error = String(e.stack || e);
  console.error(log.error);
  notify('error', `Wortling 매일 작업 실패`, String(e.message || e).slice(0, 500));
  process.exitCode = 1;
} finally {
  log.finished = new Date().toISOString();
  const dir = path.join(ROOT, 'backup', 'daily');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${log.day}.json`), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ text: log.text, images: log.images.length, failed: log.failed.length, quota: log.quota, meaning: log.meaning, progress: log.progress, neurons_est: log.neurons_est }));
}

// ── claude -p 로 글 채우기 ──────────────────────────────────────────────
function writeTextWithClaude(words) {
  const list = words.map((w) => ({ id: w.id, lemma: w.lemma, pos: w.pos, gender: w.gender, level: w.level, gloss_en: w.gloss_en }));
  const prompt = `You write Korean learning content for German vocabulary (learner: Korean speaker, level B1~B2). For EACH item below return one object:
{"id": "<same id>", "gloss_ko": "짧은 한국어 뜻 1~3개, 쉼표 구분, 20자 이내(명사는 관사 없이 명사형, 동사는 ~하다 형)", "example_de": "B1~B2 수준의 자연스러운 독일어 예문 1문장, 70자 이내, 표제어(활용형 가능) 포함", "example_ko": "예문의 자연스러운 한국어 번역, 40자 이내, ~해요체", "scene_en": "ONE English line (max 25 words) starting with 'Borti ' — a concrete visual scene where the mascot Borti (a chubby white puppy with tan floppy ears) acts out the word's meaning with ONE concrete prop or action; no text, letters, numbers, signs or logos; only Borti unless a second character is required"}
Output ONLY a JSON array (no prose, no code fence) with exactly ${list.length} objects in the same order.
Items: ${JSON.stringify(list)}`;
  const arr = askJson(prompt);
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

// ── claude -p 로 그림 장면 쓰기 ─────────────────────────────────────────────
// 2026-10-14 실측(35장 검토): 장면에 장소 + 소품 3개 + 조연까지 넣으면 4b 모델이 소품을 빼먹고 보르티만 크게 그려
// 뜻 단서가 사라졌다(los 의 기차 · verschwinden 의 빈 열쇠걸이 · einzig 의 무리 · Entscheidung 의 갈림길). → 짧게, 뜻을 맡은 물건 하나를 맨 앞에.
function writeScenesWithClaude(words) {
  const list = words.map((w) => ({ id: w.id, word: `${w.gender ? w.gender + ' ' : ''}${w.lemma}`, pos: w.pos, meaning_ko: w.gloss_ko, example_de: w.example_de, example_ko: w.example_ko }));
  const prompt = `You write image scenes for German vocabulary flashcards. Each card shows the German word, its Korean meaning, one example sentence and a simple doodle. A small image model draws the scene and drops details, so keep it SIMPLE: the picture must make the WORD's meaning obvious at a glance, set in the example sentence's moment.
Rules for each scene (ONE English line, max 28 words and 180 characters, start with "Borti"):
- Borti (a chubby white puppy) is the speaker or main person of the sentence.
- Begin with the key: what Borti does with the ONE object or action that stands for the word, drawn large.
  · noun → the thing itself, big, in its typical use (Kühlschrank: Borti opens a big fridge full of food).
  · verb → the action at its most unmistakable moment (springen: Borti mid-air, jumping over a puddle).
  · adjective → exaggerate the quality, add a contrasting opposite if it helps (eng: Borti squeezing through a very narrow gap).
  · abstract word (adverb, conjunction, particle, pronoun, idea) → the sentence's moment with ONE clear prop, plus a symbol and Borti's expression (wieso: Borti frowning at a silent phone, a big question mark above his head).
- At most 2 props and at most one other character (a puppy or kitten), only if the sentence needs them. Place = one word at most (kitchen, platform), no landscape.
- A symbol (? ! heart, sweat drop, motion lines, arrow) only when it carries the meaning (? = asking or doubt, ! = urgency or surprise), at most one; no decorative sparkles. No text, letters, numbers, signs, logos, screens with writing or speech bubbles.
Output ONLY a JSON array [{"id": "...", "scene_en": "..."}] with exactly ${list.length} items in the same order. No prose, no code fence.
Items: ${JSON.stringify(list)}`;
  const out = new Map();
  try {
    const arr = askJson(prompt);
    const ids = new Set(list.map((w) => w.id));
    // 「Borti」로 시작하라 했지만 「In a kitchen, Borti …」 처럼 와도 받는다
    for (const o of arr) if (ids.has(o?.id) && typeof o.scene_en === 'string' && /\bBorti\b/.test(o.scene_en)) out.set(o.id, o.scene_en.trim().slice(0, 300));
    if (out.size < list.length) console.error(`장면 ${list.length}개 중 ${out.size}개만 받음(나머지는 예전 장면) — 받은 원문 ${arr.length}개: ${JSON.stringify(arr).slice(0, 300)}`);
  } catch (e) {
    console.error(`장면 쓰기 실패 — 예전 장면으로 그림: ${String(e.message || e).slice(0, 200)}`);
  }
  return out;
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
    // claude 를 기다리는 사이 서버가 묵은 연결을 닫으면 「fetch failed」 → 한 번 다시
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
/** 디스코드 알림(AI_CLI 알리미). 보냈으면 true */
function notify(type, title, desc) {
  const notifier = 'C:/Users/cgpar/AI_CLI/scripts/discord-notify.js';
  if (!existsSync(notifier)) return false;
  const r = spawnSync(process.execPath, [notifier, 'send'], { input: JSON.stringify({ type, title, desc, cli: 'claude' }), encoding: 'utf8', windowsHide: true, timeout: 20000 });
  return r.status === 0;
}
