// 매일 아침 PC 에서 한 번 도는 스크립트(작업 스케줄러 → scripts/register-task.ps1).
// 하는 일 둘:
//   1) 글 채우기 — 다가오는 단어(학습 순서 앞쪽) 가운데 한국어 뜻·예문·장면이 빈 것을 claude -p 로 채운다.
//   2) 그림 만들기 — 무료 플랜 크레딧(하루 2 = Z Image 13장, 장당 0.15)으로 장면이 있는 단어의 그림을 만들어 올린다.
// Worker 관리 API 만 쓴다(wrangler 불필요). 준비물: .env(APP_URL · API_TOKEN), higgsfield 로그인, claude 로그인.
// 되풀이해도 안전하다 — 이미 채워진 단어·그림은 다시 하지 않는다.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));

const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || '';
const TEXT_AHEAD = Number(process.env.DAILY_TEXT_AHEAD || 60); // 글을 미리 채워 둘 단어 수
const IMAGE_MAX = Number(process.env.DAILY_IMAGE_MAX || 13); // 하루 그림 상한(무료 2크레딧 ÷ 0.15)
const COST_PER_IMAGE = 0.15; // Z Image 실측(2026-10-13)
const RESERVE = Number(process.env.DAILY_CREDIT_RESERVE || 0); // 남겨 둘 크레딧
const DRY = process.argv.includes('--dry');
const NO_IMAGE = process.argv.includes('--no-image');
const NO_TEXT = process.argv.includes('--no-text');

// 장면이 앞, 보르티 설명이 뒤. 장면을 뒤에 두었더니 마스코트만 크게 나오고 뜻이 안 보였다(2026-10-13 사용자 지적).
const REDO = (process.argv.find((a) => a.startsWith('--redo=')) || '').slice(7).split(',').filter(Boolean);
// 실측: 프롬프트가 800자를 넘으면 job 이 사유 없이 failed(835자 3건 실패, 641자 이하 전부 성공) → 780자 상한
const PROMPT_MAX = 780;
function imagePrompt(scene) {
  const tail =
    ' Main character Borti: cute chubby cream dachshund puppy, big round head, tiny body, big glossy eyes with highlights, rosy cheeks, ' +
    'brown floppy ears; other animals in the same cute chibi style. Medium-wide shot, the key action and objects large and clear. ' +
    'Premium mascot quality, soft matte clay, Pixar-like softness, studio lighting, pastel colors, light mint tone. ' +
    'No text, letters, numbers, logos or speech bubbles.';
  const head = '3D clay render illustration. Scene: ';
  let sc = scene.trim();
  const room = PROMPT_MAX - head.length - tail.length;
  if (sc.length > room) sc = sc.slice(0, room).replace(/[,;]?\s+\S*$/, '') + '.';
  return head + sc + tail;
}

const HIGGS_JS = path.join(npmGlobalRoot(), '@higgsfield', 'cli', 'bin', 'higgsfield.js');
const CLAUDE_EXE =
  process.platform === 'win32'
    ? path.join(npmGlobalRoot(), '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    : 'claude';

const log = { day: kstDay(), started: new Date().toISOString(), text: 0, images: [], failed: [], credits: {} };

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
    const status = higgs(['account', 'status', '--json']);
    let credits = Number(status.credits || 0);
    log.credits.before = credits;
    const budget = Math.min(IMAGE_MAX, Math.floor((credits - RESERVE) / COST_PER_IMAGE + 1e-9));
    // --redo=w0001,w0002 : 이미 있는 그림을 새 장면으로 다시 그림(상태 무관). 없으면 그림 없는 단어를 학습 순서대로
    const ids = REDO.length ? REDO.slice(0, budget) : budget > 0 ? (await api(`/api/admin/runway?text=0&image=${budget}`)).need_image.map((w) => w.id) : [];
    const need = [];
    for (const id of ids) need.push((await api(`/api/word/${id}`)).word);
    // 그리기 직전에 「카드 예문 장면」 으로 장면을 새로 쓴다 → 그림 · 단어 · 예문이 같은 순간을 가리킴
    const briefs = need.length && !DRY ? writeScenesWithClaude(need) : new Map();
    if (briefs.size) await api('/api/admin/words', { method: 'POST', body: { items: [...briefs].map(([id, scene_en]) => ({ id, scene_en })) } });
    console.log(`크레딧 ${credits} → 오늘 그림 ${need.length}장(상한 ${budget}), 새 장면 ${briefs.size}`);
    for (const w of need) {
      const scene = briefs.get(w.id) || w.scene_en;
      if (!scene) continue;
      const prompt = imagePrompt(scene);
      if (DRY) { console.log(`[dry] ${w.id} ${w.lemma}: ${scene}`); continue; }
      const t0 = Date.now();
      let job;
      const gen = () => higgs(['generate', 'create', 'z_image', '--aspect_ratio', '4:3', '--prompt', prompt, '--wait', '--wait-timeout', '5m', '--json']);
      try {
        try { job = gen(); } catch (e) {
          if (/credit|balance|insufficient/i.test(String(e.message))) throw e;
          console.error(`다시 시도 ${w.id}: ${String(e.message || e).slice(0, 120)}`); // 실측: 가끔 job 이 「failed」로 끝남
          job = gen();
        }
      } catch (e) {
        log.failed.push({ id: w.id, error: String(e.message || e).slice(0, 300) });
        // 다시 그리기(--redo)면 있던 그림을 지킨다. 새 단어만 실패 표시(머리글자 칸)
        if (!REDO.length) await api(`/api/admin/image/${w.id}?status=failed`, { method: 'PUT' });
        if (/credit|balance|insufficient/i.test(String(e.message))) break;
        continue;
      }
      const j = Array.isArray(job) ? job[0] : job;
      const url = j?.result_url || j?.min_result_url;
      if (!url) {
        log.failed.push({ id: w.id, error: 'result_url 없음' });
        if (!REDO.length) await api(`/api/admin/image/${w.id}?status=failed`, { method: 'PUT' });
        continue;
      }
      const png = Buffer.from(await (await fetch(url)).arrayBuffer());
      // 실측: 가끔 새까만 그림이 온다(w0010, 편차 0) → 올리지 않고 실패로 표시(카드는 머리글자 칸)
      const { channels } = await sharp(png).stats();
      if (channels.every((c) => c.stdev < 4)) {
        log.failed.push({ id: w.id, error: 'blank_image' });
        if (!REDO.length) await api(`/api/admin/image/${w.id}?status=failed`, { method: 'PUT' });
        console.log(`그림 ${w.id} ${w.lemma} 단색 → 실패 처리`);
        continue;
      }
      const webp = await toWebp(png);
      await api(`/api/admin/image/${w.id}`, { method: 'PUT', raw: webp, headers: { 'content-type': 'image/webp' } });
      credits -= COST_PER_IMAGE;
      log.images.push({ id: w.id, lemma: w.lemma, kb: +(webp.length / 1024).toFixed(1), sec: +((Date.now() - t0) / 1000).toFixed(1) });
      console.log(`그림 ${w.id} ${w.lemma} ${(webp.length / 1024).toFixed(1)}KB ${((Date.now() - t0) / 1000).toFixed(0)}초`);
    }
    try { log.credits.after = Number(higgs(['account', 'status', '--json']).credits); } catch { log.credits.after = credits; }
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
      notifyError('Wortling 백업 실패', `${log.backup_error}\n→ PC 에서 npx wrangler login 다시`);
    }
  }
} catch (e) {
  log.error = String(e.stack || e);
  console.error(log.error);
  notifyError(`Wortling 매일 작업 실패`, String(e.message || e).slice(0, 500));
  process.exitCode = 1;
} finally {
  log.finished = new Date().toISOString();
  const dir = path.join(ROOT, 'backup', 'daily');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${log.day}.json`), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ text: log.text, images: log.images.length, failed: log.failed.length, credits: log.credits }));
}

// ── claude -p 로 글 채우기 ──────────────────────────────────────────────
function writeTextWithClaude(words) {
  const list = words.map((w) => ({ id: w.id, lemma: w.lemma, pos: w.pos, gender: w.gender, level: w.level, gloss_en: w.gloss_en }));
  const prompt = `You write Korean learning content for German vocabulary (learner: Korean speaker, level B1~B2). For EACH item below return one object:
{"id": "<same id>", "gloss_ko": "짧은 한국어 뜻 1~3개, 쉼표 구분, 20자 이내(명사는 관사 없이 명사형, 동사는 ~하다 형)", "example_de": "B1~B2 수준의 자연스러운 독일어 예문 1문장, 70자 이내, 표제어(활용형 가능) 포함", "example_ko": "예문의 자연스러운 한국어 번역, 40자 이내, ~해요체", "scene_en": "ONE English line (max 25 words) starting with 'Borti ' — a concrete visual scene where the mascot Borti (a chubby cream dachshund puppy with brown floppy ears) acts out the word's meaning with a concrete prop or action; no text, letters, numbers, signs or logos; only Borti unless a second character is required"}
Output ONLY a JSON array (no prose, no code fence) with exactly ${list.length} objects in the same order.
Items: ${JSON.stringify(list)}`;
  const r = spawnSync(CLAUDE_EXE, ['-p', '--output-format', 'json', '--model', 'sonnet', '--max-turns', '1', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`claude -p 실패: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  const outer = JSON.parse(r.stdout);
  const text = String(outer.result ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let arr;
  try { arr = JSON.parse(text); } catch { throw new Error(`claude 결과가 JSON 이 아님: ${text.slice(0, 200)}`); }
  const ids = new Set(list.map((w) => w.id));
  const items = [];
  for (const o of Array.isArray(arr) ? arr : []) {
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

// ── claude -p 로 그림 장면 쓰기(카드 예문과 같은 순간) ─────────────────────
function writeScenesWithClaude(words) {
  const list = words.map((w) => ({ id: w.id, word: `${w.gender ? w.gender + ' ' : ''}${w.lemma}`, pos: w.pos, meaning_ko: w.gloss_ko, example_de: w.example_de, example_ko: w.example_ko }));
  const prompt = `You write image scenes for German vocabulary flashcards. Each card shows: the German word, its Korean meaning, one example sentence, and a 3D clay picture. The picture must show THE SAME MOMENT as the example sentence, so the word, the sentence and the picture obviously belong together.
Rules for each scene (ONE English line, max 35 words and 230 characters, start with "Borti"):
- Borti (a chubby cream dachshund puppy) plays the speaker or main person of the example sentence. Other people in the sentence become other cute puppies or kittens.
- The WORD must be recognizable from the picture alone, then the sentence confirms it:
  · noun → the thing itself, big and central, in its typical use (Kühlschrank: Borti opens a big fridge full of food).
  · verb → Borti doing the action at its most typical, unmistakable moment (springen: mid-air jump over a puddle).
  · adjective → exaggerate the quality, add a contrasting opposite if it helps (eng: Borti squeezing through a very narrow gap between two wide ones).
  · adverb, conjunction, particle, pronoun → the sentence's situation, with Borti's pose and facial expression carrying the meaning.
- Name the concrete place (kitchen, office, train platform…) and 1–3 concrete props.
- No text, letters, numbers, signs, logos, screens with writing, or speech bubbles.
Output ONLY a JSON array [{"id": "...", "scene_en": "..."}] with exactly ${list.length} items in the same order. No prose, no code fence.
Items: ${JSON.stringify(list)}`;
  const r = spawnSync(CLAUDE_EXE, ['-p', '--output-format', 'json', '--model', 'sonnet', '--max-turns', '1', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], {
    input: prompt, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 10 * 60 * 1000, windowsHide: true,
  });
  const out = new Map();
  try {
    const arr = JSON.parse(String(JSON.parse(r.stdout).result ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    for (const o of arr) if (o?.id && typeof o.scene_en === 'string' && /^Borti\b/.test(o.scene_en.trim())) out.set(o.id, o.scene_en.trim().slice(0, 400));
  } catch (e) {
    console.error(`장면 쓰기 실패 — 예전 장면으로 그림: ${String(e.message || e).slice(0, 200)}`);
  }
  return out;
}

// ── 힉스필드 CLI ──────────────────────────────────────────────────────────
function higgs(args) {
  const out = execFileSync(process.execPath, [HIGGS_JS, ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 6 * 60 * 1000, windowsHide: true });
  const s = out.trim();
  const i = s.search(/[\[{]/);
  return JSON.parse(i >= 0 ? s.slice(i) : s);
}

async function toWebp(png) {
  for (const quality of [82, 70, 60, 50]) {
    const buf = await sharp(png).resize(640, 480, { fit: 'cover' }).webp({ quality }).toBuffer();
    if (buf.length <= 60 * 1024) return buf; // 게이트 G8′: webp ≤ 60KB
  }
  return sharp(png).resize(640, 480, { fit: 'cover' }).webp({ quality: 45 }).toBuffer();
}

// ── Worker 관리 API ──────────────────────────────────────────────────────
async function api(p, { method = 'GET', body, raw, headers = {} } = {}) {
  const init = {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  };
  let res;
  try {
    res = await fetch(APP_URL + p, init);
  } catch (e) {
    // claude·힉스필드를 기다리는 사이 서버가 묵은 연결을 닫으면 「fetch failed」 → 한 번 다시
    console.error(`재시도 ${method} ${p}: ${e.cause?.code || e.message}`);
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(APP_URL + p, init);
  }
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
function npmGlobalRoot() {
  if (process.env.NPM_GLOBAL_ROOT) return process.env.NPM_GLOBAL_ROOT;
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'npm', 'node_modules');
  return execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
}
function kstDay(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function notifyError(title, desc) {
  const notifier = 'C:/Users/cgpar/AI_CLI/scripts/discord-notify.js';
  if (!existsSync(notifier)) return;
  try {
    spawnSync(process.execPath, [notifier, 'send'], { input: JSON.stringify({ type: 'error', title, desc, cli: 'claude' }), encoding: 'utf8', windowsHide: true, timeout: 20000 });
  } catch { /* 알림 실패는 무시 */ }
}
