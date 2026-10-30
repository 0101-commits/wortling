// Kaggle 무료 GPU 대량 그리기(기획 G4)의 깃허브 러너 쪽 — .github/workflows/kaggle-draw.yml 이 부른다.
//   node scripts/kaggle.mjs pick <n> <빌드폴더>   그림 없는 단어 n 개를 골라 jobs.json 과 커널 파일을 빌드폴더에 만든다(GITHUB_OUTPUT count=)
//   node scripts/kaggle.mjs collect <내려받은폴더>  커널 결과(out/<id>.webp · verdicts.json)를 자동 검사 → 통과분 올리기 → 장부 기록
// 프롬프트는 daily.mjs 와 같은 style.mjs imagePrompt, 검사 질문은 judge.mjs buildPrompt 를 그대로 쓴다.
// Worker 관리 API 로만 올린다(daily.mjs 와 같은 Bearer API_TOKEN).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { REF_FILE, imagePrompt } from './style.mjs';
import { buildPrompt } from './judge.mjs';
import { pixelStats, ocrChars, verdict } from './imgcheck.mjs';
import { ledgerConfig, loadLedger, saveLedger, recordDraw, recordAuto, recordJudge } from './ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || '';
const MODEL = 'kaggle-klein4b';
const LEDGER_FILE = path.join(ROOT, '.data', 'ledger.json');
const QUEUE_FILE = path.join(ROOT, '.data', 'kaggle-queue.json'); // 커널에 맡겼고 아직 못 거둔 단어 {id: 맡긴 날(ISO)}
const REJECT_DIR = path.join(ROOT, '.data', 'rejected');
const QUEUE_DAYS = 3; // 이 날짜가 지나면 못 거둔 걸로 보고 다시 뽑을 수 있다

async function api(p, { method = 'GET', body, raw, headers = {} } = {}) {
  const res = await fetch(APP_URL + p, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const readJson = (f, d) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return d;
  }
};
const writeQueue = (q) => {
  mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  writeFileSync(QUEUE_FILE, JSON.stringify(q));
};
const setOutput = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

/** 폴더 안(하위 포함)에서 파일 이름으로 찾기 */
function findFile(dir, name) {
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) {
      const r = findFile(f, name);
      if (r) return r;
    } else if (e === name) return f;
  }
  return null;
}

async function pick(n, dir) {
  if (!APP_URL || !TOKEN) throw new Error('APP_URL · API_TOKEN 이 없다');
  const cfg = ledgerConfig();
  const ledger = loadLedger(LEDGER_FILE);
  const queue = readJson(QUEUE_FILE, {});
  const now = Date.now();
  for (const [id, at] of Object.entries(queue)) if (now - Date.parse(at) > QUEUE_DAYS * 86_400_000) delete queue[id];
  // 검사 대기(KV pending) 그림이 있는 단어 · 맡겨 둔 단어 · 검사 두 번 탈락한 어려운 단어(daily 가 큰 모델로 그린다)는 뺀다
  const pending = new Set((await api('/api/admin/pending').catch(() => ({ items: [] }))).items.map((x) => x.id));
  const skip = (id) => pending.has(id) || id in queue || (ledger.fails[id] ?? 0) >= cfg.hardFails;
  // daily.mjs 와 같은 규칙: runway(공부 중인 카드 먼저 → 학습 순서) 중 장면이 있는 그림 없는 단어
  const want = n + pending.size + Object.keys(queue).length + Object.keys(ledger.fails).length + 20;
  const { need_image } = await api(`/api/admin/runway?text=0&image=${Math.min(500, want)}`);
  console.log(`그림 없고 장면 있는 단어 ${need_image.length}(요청 ${Math.min(500, want)}) · 대기 ${pending.size} · 맡김 ${Object.keys(queue).length}`);
  const jobs = [];
  for (const w of need_image) {
    if (jobs.length >= n) break;
    if (skip(w.id)) continue;
    let word;
    try {
      word = (await api(`/api/word/${w.id}`)).word;
    } catch (e) {
      if (/→ 404/.test(String(e.message))) continue;
      throw e;
    }
    if (word.image || !w.scene_en) continue;
    const label = `${word.gender ? word.gender + ' ' : ''}${word.lemma}`;
    jobs.push({
      id: w.id,
      word: label,
      meaning_ko: word.gloss_ko,
      prompt: imagePrompt(w.scene_en, true),
      judge_prompt: buildPrompt([{ n: 1, word: label, meaning_ko: word.gloss_ko }]),
    });
  }
  setOutput('count', jobs.length);
  console.log(`이번에 맡길 단어 ${jobs.length}/${n}`);
  if (!jobs.length) return;
  mkdirSync(dir, { recursive: true });
  const meta = JSON.parse(readFileSync(path.join(ROOT, 'kaggle', 'kernel-metadata.json'), 'utf8'));
  if (process.env.KAGGLE_USERNAME) meta.id = `${process.env.KAGGLE_USERNAME}/${meta.id.split('/')[1]}`;
  writeFileSync(path.join(dir, 'kernel-metadata.json'), JSON.stringify(meta, null, 2));
  copyFileSync(path.join(ROOT, 'kaggle', 'draw.py'), path.join(dir, 'draw.py'));
  copyFileSync(REF_FILE, path.join(dir, 'borti-ref.png'));
  writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
  setOutput('kernel', meta.id);
  const at = new Date().toISOString();
  for (const j of jobs) queue[j.id] = at;
  writeQueue(queue);
}

async function toWebp(png) {
  // daily.mjs toWebp 와 같은 규격 — 640×480 · webp ≤ 60KB(게이트 G8′)
  for (const quality of [82, 70, 60, 50]) {
    const buf = await sharp(png).resize(640, 480, { fit: 'cover' }).webp({ quality }).toBuffer();
    if (buf.length <= 60 * 1024) return buf;
  }
  return sharp(png).resize(640, 480, { fit: 'cover' }).webp({ quality: 45 }).toBuffer();
}

async function collect(dir) {
  if (!APP_URL || !TOKEN) throw new Error('APP_URL · API_TOKEN 이 없다');
  const vf = findFile(dir, 'verdicts.json');
  const jf = findFile(dir, 'jobs.json');
  if (!vf || !jf) throw new Error('커널 결과(verdicts.json · jobs.json)가 없다 — 커널이 끝까지 못 돌았다');
  const { meta, items } = JSON.parse(readFileSync(vf, 'utf8'));
  const jobs = JSON.parse(readFileSync(jf, 'utf8'));
  const day = new Date().toISOString().slice(0, 10);
  const ledger = loadLedger(LEDGER_FILE);
  const queue = readJson(QUEUE_FILE, {});
  const sum = { jobs: jobs.length, drawn: 0, judged: 0, judge_ok: 0, auto_checked: 0, auto_ok: 0, uploaded: 0, failed: [] };
  const rows = [];
  for (const j of jobs) {
    const it = items[j.id] ?? { cands: [] };
    sum.drawn += it.cands?.length ?? 0;
    const file = findFile(dir, `${j.id}.webp`);
    rows.push({ j, it, file, buf: file ? readFileSync(file) : null });
  }
  // 자동 검사(흰 바탕 · 색 수 · 선 · 글자 OCR) — 커널이 고른 그림 전부(통과율을 재려고)
  const withImg = rows.filter((r) => r.buf);
  const tmp = withImg.map((r) => r.file);
  const chars = ocrChars(tmp);
  for (const [i, r] of withImg.entries()) {
    r.stats = await pixelStats(r.buf);
    r.why = verdict(r.stats, chars[i]);
    r.chars = chars[i];
    sum.auto_checked++;
    if (!r.why.length) sum.auto_ok++;
  }
  mkdirSync(REJECT_DIR, { recursive: true });
  for (const r of rows) {
    const { j, it } = r;
    delete queue[j.id];
    for (const c of it.cands ?? []) recordDraw(ledger, day, MODEL, 0);
    if (!r.buf) {
      sum.failed.push({ id: j.id, why: 'no_image' });
      continue;
    }
    const judged = typeof it.verdict?.ok === 'boolean';
    const judgeOk = it.ok === true;
    if (judged) {
      sum.judged++;
      if (judgeOk) sum.judge_ok++;
    }
    const autoOk = r.why.length === 0;
    if (autoOk) recordAuto(ledger, MODEL, true);
    // 판정을 못 받은(parse 실패) 그림은 올리지 않고 장부에도 안 적는다
    if (judged) recordJudge(ledger, j.id, MODEL, judgeOk);
    if (!(judgeOk && autoOk)) {
      const why = [!judgeOk ? `judge: ${it.verdict?.why ?? 'null'}` : null, ...r.why].filter(Boolean).join(' / ');
      sum.failed.push({ id: j.id, why });
      writeFileSync(path.join(REJECT_DIR, `${j.id}_kaggle_${judgeOk ? 'check' : 'meaning'}.webp`), await toWebp(r.buf));
      continue;
    }
    try {
      if ((await api(`/api/word/${j.id}`)).word.image) { // 그사이 다른 길로 그림이 생김
        sum.failed.push({ id: j.id, why: 'already_has_image' });
        continue;
      }
      await api(`/api/admin/image/${j.id}`, { method: 'PUT', raw: await toWebp(r.buf), headers: { 'content-type': 'image/webp' } });
      ledger.drawn_by[j.id] = MODEL;
      sum.uploaded++;
      console.log(`올림 ${j.id} ${j.word}`);
    } catch (e) {
      sum.failed.push({ id: j.id, why: `upload: ${String(e.message).slice(0, 150)}` });
    }
  }
  mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
  saveLedger(LEDGER_FILE, ledger);
  writeQueue(queue);
  const secs = { draw_sec_avg: meta?.draw_sec_avg, judge_sec_avg: meta?.judge_sec_avg, gpu: meta?.gpu, placement: meta?.placement, load_draw_sec: meta?.load_draw_sec, load_judge_sec: meta?.load_judge_sec };
  console.log('요약', JSON.stringify({ ...sum, ...secs, failed: undefined }));
  for (const f of sum.failed) console.log(`  탈락 ${f.id}: ${f.why}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Kaggle 그리기\n\n\`\`\`json\n${JSON.stringify({ ...sum, ...secs }, null, 1)}\n\`\`\`\n`);
  }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'pick') await pick(Number(a) || 10, b || path.join(ROOT, 'kaggle', 'build'));
else if (cmd === 'collect') await collect(a);
else {
  console.error('사용: node scripts/kaggle.mjs pick <n> <빌드폴더> | collect <결과폴더>');
  process.exit(1);
}
