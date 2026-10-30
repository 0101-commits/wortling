// Kaggle 무료 GPU 대량 그리기(기획 G4)의 깃허브 러너 쪽 — .github/workflows/kaggle-draw.yml 이 부른다.
//   node scripts/kaggle.mjs pick <n> <빌드폴더>        그림 없는 단어 n 개를 골라 커널 파일을 빌드폴더에 만든다(GITHUB_OUTPUT count=)
//   node scripts/kaggle.mjs collect <내려받은폴더>      커널 결과를 자동 검사 → 통과분 올리기 → 상태 변경 목록(ops) 기록
//   node scripts/kaggle.mjs calibrate <ids> <빌드폴더>  이미 올라간 그림을 커널의 엄격 검사에만 돌려 본다(그리기 없음 · 올리기 없음)
//   node scripts/kaggle.mjs report <내려받은폴더>       calibrate 결과 출력
//   node scripts/kaggle.mjs revert <ids>               검사 탈락처럼 되돌리기(그림 내림 + 다시 그리기 목록)
//   node scripts/kaggle.mjs apply                      .data/kaggle-ops.json 을 지금의 장부·맡김·다시그리기 파일에 적용(kaggle-commit.sh 가 부른다)
// 프롬프트는 daily.mjs 와 같은 style.mjs imagePrompt, 검사 질문은 judge.mjs buildPrompt 에 엄격 2단계를 덧붙인 것.
// 상태 파일(.data/*)은 daily 와 같은 main 에 되올리므로, 파일을 직접 고치지 않고 「변경 목록」만 쓴다 — 되올릴 때 최신 main 파일에 다시 적용한다(동시에 도는 daily 와 안 부딪힘).
import { gzipSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, appendFileSync, lstatSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
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
const RESTYLE_FILE = path.join(ROOT, '.data', 'restyle.json'); // daily.mjs 의 다시 그리기 목록(id 배열)
const OPS_FILE = path.join(ROOT, '.data', 'kaggle-ops.json');
const REJECT_DIR = path.join(ROOT, '.data', 'rejected');
const QUEUE_DAYS = 3; // 이 날짜가 지나면 못 거둔 걸로 보고 다시 뽑을 수 있다
// 단어 id 형식(seed/build.mjs: w0001…). 내려받은 커널 결과는 믿지 않는다 — 올릴 id 는 우리가 맡길 때 적어 둔 목록(QUEUE_FILE)에서만, 형식도 한 번 더 본다
const ID_RE = /^w\d{4,6}$/;

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
const setOutput = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

/** 상태 변경 목록(ops) — 이번 실행이 장부·맡김·다시그리기에 할 일. apply 가 최신 파일에 적용한다 */
const emptyOps = () => ({ queueAdd: [], queueRemove: [], draws: 0, autoPass: 0, judges: [], drawnBy: [], restyleAdd: [] });
function saveOps(ops) {
  mkdirSync(path.dirname(OPS_FILE), { recursive: true });
  writeFileSync(OPS_FILE, JSON.stringify(ops));
}

function applyOps() {
  const ops = { ...emptyOps(), ...readJson(OPS_FILE, {}) };
  const clean = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && ID_RE.test(x)) : []);
  const day = new Date().toISOString().slice(0, 10);
  const ledger = loadLedger(LEDGER_FILE);
  for (let i = 0; i < Number(ops.draws) || 0; i++) recordDraw(ledger, day, MODEL, 0);
  for (let i = 0; i < Number(ops.autoPass) || 0; i++) recordAuto(ledger, MODEL, true);
  for (const [id, ok] of Array.isArray(ops.judges) ? ops.judges : []) if (ID_RE.test(id)) recordJudge(ledger, id, MODEL, ok === true);
  for (const id of clean(ops.drawnBy)) ledger.drawn_by[id] = MODEL;
  mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
  saveLedger(LEDGER_FILE, ledger);
  const queue = readJson(QUEUE_FILE, {});
  const at = new Date().toISOString();
  for (const id of clean(ops.queueRemove)) delete queue[id];
  for (const id of clean(ops.queueAdd)) queue[id] = at;
  writeFileSync(QUEUE_FILE, JSON.stringify(queue));
  const add = clean(ops.restyleAdd);
  if (add.length) {
    const rs = readJson(RESTYLE_FILE, []);
    writeFileSync(RESTYLE_FILE, JSON.stringify([...add, ...rs.filter((x) => !add.includes(x))])); // 맨 앞(daily.mjs recheck 와 같은 규칙)
  }
  if (existsSync(OPS_FILE)) unlinkSync(OPS_FILE);
  console.log(`상태 적용: 그림 ${ops.draws} · 자동통과 ${ops.autoPass} · 판정 ${ops.judges.length} · 맡김 +${ops.queueAdd.length}/-${ops.queueRemove.length} · 다시그리기 +${add.length}`);
}

/** 폴더 안(하위 포함)에서 파일 이름으로 찾기 */
function findFile(dir, name) {
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e);
    const st = lstatSync(f);
    if (st.isSymbolicLink()) continue; // 내려받은 폴더의 바로가기는 따라가지 않는다
    if (st.isDirectory()) {
      const r = findFile(f, name);
      if (r) return r;
    } else if (e === name) return f;
  }
  return null;
}

/** 엄격 2단계 검사 질문. 1단계 = 단어를 모른 채 그림만 묘사 · 2단계 = 묘사 + 의도한 장면으로 뜻이 보이는지·단어를 짐작할 수 있는지.
 *  daily 의 검사(buildPrompt: 뜻·몸 구조·글자)는 그대로 두고 아래 항목을 더한다. 최종 ok = ok && key_visible && guessable (kaggle/draw.py) */
function strictPrompts(label, meaning, scene) {
  const desc =
    'Describe this doodle picture in 3-6 short factual sentences: every object, every character with its pose and expression, symbols, and the setting. ' +
    'Count legs/paws, ears, tails and heads of every animal. Mention any letters or numbers drawn. Do not guess what word it illustrates; only say what is visibly drawn.';
  const check = `A neutral describer who did not know the word wrote this description of the attached picture:
"""{DESC}"""
${buildPrompt([{ n: 1, word: label, meaning_ko: meaning }])}
STRICT EXTRA CHECKS (the description above is evidence; the picture itself decides):
The image prompt asked for this scene: "${scene}".
- key_visible: true only if the ONE object or action that carries the meaning of the word is clearly drawn and recognizable (large, not tiny, not merely implied). A hat, accessory or generic prop that does not by itself express the meaning counts as NOT visible. Check each key element of the scene against the description.
- guessable: true only if a learner who sees only the picture (no word) could single out THIS word among several unrelated words. Generic pictures (the puppy just standing, sitting, smiling or wearing something, holding a vague object) fit many words → false.
- body_ok: true only if no animal has wrong counts of legs/paws, ears, eyes, tails or heads and none of the body problems listed above.
- text_ok: false if any letters or numbers are drawn (symbols ? ! heart are fine).
FINAL OUTPUT FORMAT (replaces the format asked above): ONLY a JSON array with exactly 1 item: [{"n":1,"ok":true,"key_visible":true,"guessable":true,"body_ok":true,"text_ok":true,"why":"짧은 한국어 이유"}]. ok must be false when any of key_visible, guessable, body_ok, text_ok is false.`;
  return { desc_prompt: desc, check_prompt: check };
}

async function wordInfo(id) {
  const d = await api(`/api/word/${encodeURIComponent(id)}`);
  const word = d.word;
  return { word, scene: d.scene_en, label: `${word.gender ? word.gender + ' ' : ''}${word.lemma}` };
}

function writeKernel(dir, jobs) {
  mkdirSync(dir, { recursive: true });
  const meta = JSON.parse(readFileSync(path.join(ROOT, 'kaggle', 'kernel-metadata.json'), 'utf8'));
  if (process.env.KAGGLE_USERNAME) meta.id = `${process.env.KAGGLE_USERNAME}/${meta.id.split('/')[1]}`;
  writeFileSync(path.join(dir, 'kernel-metadata.json'), JSON.stringify(meta, null, 2));
  // 스크립트 커널은 코드 파일만 올라간다 → jobs·참고 그림을 draw.py 의 PAYLOAD 줄에 gzip+base64 로 넣는다
  const payload = gzipSync(JSON.stringify({ jobs, ref: readFileSync(REF_FILE).toString('base64') })).toString('base64');
  const code = readFileSync(path.join(ROOT, 'kaggle', 'draw.py'), 'utf8').replace("PAYLOAD = ''  # @@PAYLOAD@@", () => `PAYLOAD = '${payload}'`);
  if (!code.includes(payload)) throw new Error('draw.py 에 PAYLOAD 줄이 없다');
  writeFileSync(path.join(dir, 'draw.py'), code);
  setOutput('kernel', meta.id);
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
    if (!ID_RE.test(w.id) || skip(w.id)) continue;
    let info;
    try {
      info = await wordInfo(w.id);
    } catch (e) {
      if (/→ 404/.test(String(e.message))) continue;
      throw e;
    }
    if (info.word.image || !w.scene_en) continue;
    jobs.push({ id: w.id, word: info.label, meaning_ko: info.word.gloss_ko, prompt: imagePrompt(w.scene_en, true), ...strictPrompts(info.label, info.word.gloss_ko, w.scene_en) });
  }
  setOutput('count', jobs.length);
  console.log(`이번에 맡길 단어 ${jobs.length}/${n}`);
  if (!jobs.length) return;
  writeKernel(dir, jobs);
  saveOps({ ...emptyOps(), queueAdd: jobs.map((j) => j.id) });
}

/** 이미 올라간 그림(공개 /img)을 엄격 검사에만 돌린다 — 판정 보정용 */
async function calibrate(ids, dir) {
  if (!APP_URL || !TOKEN) throw new Error('APP_URL · API_TOKEN 이 없다');
  const jobs = [];
  for (const id of ids.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!ID_RE.test(id)) throw new Error(`id 형식 오류: ${id}`);
    const info = await wordInfo(id);
    const res = await fetch(`${APP_URL}/img/${encodeURIComponent(id)}.webp`);
    if (!res.ok) throw new Error(`그림 없음 ${id}`);
    jobs.push({ id, word: info.label, meaning_ko: info.word.gloss_ko, image: Buffer.from(await res.arrayBuffer()).toString('base64'), ...strictPrompts(info.label, info.word.gloss_ko, info.scene) });
  }
  writeKernel(dir, jobs);
  setOutput('count', jobs.length);
}

function report(dir) {
  const vf = findFile(dir, 'verdicts.json');
  if (!vf) throw new Error('verdicts.json 이 없다');
  const { meta, items } = JSON.parse(readFileSync(vf, 'utf8'));
  console.log('meta', JSON.stringify(meta));
  for (const [id, it] of Object.entries(items)) {
    const c = it.cands?.[0] ?? {};
    console.log(`${id} ok=${it.ok} ${JSON.stringify(c.verdict)}\n   desc: ${String(c.desc ?? '').replace(/\s+/g, ' ').slice(0, 500)}`);
  }
}

async function revert(ids) {
  if (!APP_URL || !TOKEN) throw new Error('APP_URL · API_TOKEN 이 없다');
  const ops = emptyOps();
  for (const id of ids.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!ID_RE.test(id)) throw new Error(`id 형식 오류: ${id}`);
    // daily.mjs 다시 검사 탈락과 같은 처리: 그림을 내리고(failed = 머리글자 칸) 다시 그리기 목록 맨 앞
    await api(`/api/admin/image/${encodeURIComponent(id)}?status=failed`, { method: 'PUT' });
    ops.restyleAdd.push(id);
    ops.judges.push([id, false]);
    console.log(`되돌림 ${id}: image_status=failed · 다시 그리기 목록`);
  }
  saveOps(ops);
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
  if (!vf) throw new Error('커널 결과(verdicts.json)가 없다 — 커널이 끝까지 못 돌았다');
  const { meta, items: got } = JSON.parse(readFileSync(vf, 'utf8'));
  const queue = readJson(QUEUE_FILE, {});
  // 올릴 단어 = 맡길 때 적어 둔 목록 ∩ 형식 맞는 id. 내려받은 jobs.json·verdicts 의 id 는 이 목록에 있는 것만 본다(jobs.json 은 로그용 글만 참고)
  const ids = Object.keys(queue).filter((id) => ID_RE.test(id));
  const downJobs = jf && Array.isArray(readJson(jf, [])) ? readJson(jf, []) : [];
  const jobs = ids.map((id) => ({ id, word: String(downJobs.find((x) => x?.id === id)?.word ?? id).slice(0, 60) }));
  const items = Object.fromEntries(ids.map((id) => [id, Object.hasOwn(got ?? {}, id) && got[id] && typeof got[id] === 'object' ? got[id] : { cands: [] }]));
  const ops = { ...emptyOps(), queueRemove: ids };
  const sum = { jobs: jobs.length, drawn: 0, judged: 0, judge_ok: 0, auto_checked: 0, auto_ok: 0, uploaded: 0, failed: [] };
  const rows = [];
  for (const j of jobs) {
    const it = items[j.id];
    sum.drawn += Array.isArray(it.cands) ? it.cands.length : 0;
    const file = findFile(dir, `${j.id}.webp`);
    rows.push({ j, it, file, buf: file ? readFileSync(file) : null });
  }
  // 자동 검사(흰 바탕 · 색 수 · 선 · 글자 OCR) — 커널이 고른 그림 전부(통과율을 재려고)
  const withImg = rows.filter((r) => r.buf);
  const chars = ocrChars(withImg.map((r) => r.file));
  for (const [i, r] of withImg.entries()) {
    r.stats = await pixelStats(r.buf);
    r.why = verdict(r.stats, chars[i]);
    sum.auto_checked++;
    if (!r.why.length) sum.auto_ok++;
  }
  mkdirSync(REJECT_DIR, { recursive: true });
  for (const r of rows) {
    const { j, it } = r;
    ops.draws += Array.isArray(it.cands) ? it.cands.length : 0;
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
    if (autoOk) ops.autoPass++;
    // 판정을 못 받은(parse 실패) 그림은 올리지 않고 장부에도 안 적는다
    if (judged) ops.judges.push([j.id, judgeOk]);
    if (!(judgeOk && autoOk)) {
      const why = [!judgeOk ? `judge: ${String(it.verdict?.why ?? 'null').slice(0, 120)}` : null, ...r.why].filter(Boolean).join(' / ');
      sum.failed.push({ id: j.id, why });
      writeFileSync(path.join(REJECT_DIR, `${j.id}_kaggle_${judgeOk ? 'check' : 'meaning'}.webp`), await toWebp(r.buf));
      continue;
    }
    try {
      if ((await api(`/api/word/${encodeURIComponent(j.id)}`)).word.image) { // 그사이 다른 길로 그림이 생김
        sum.failed.push({ id: j.id, why: 'already_has_image' });
        continue;
      }
      await api(`/api/admin/image/${encodeURIComponent(j.id)}`, { method: 'PUT', raw: await toWebp(r.buf), headers: { 'content-type': 'image/webp' } });
      ops.drawnBy.push(j.id);
      sum.uploaded++;
      console.log(`올림 ${j.id} ${j.word}`);
    } catch (e) {
      sum.failed.push({ id: j.id, why: `upload: ${String(e.message).slice(0, 150)}` });
    }
  }
  saveOps(ops);
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
else if (cmd === 'calibrate') await calibrate(a, b || path.join(ROOT, 'kaggle', 'build'));
else if (cmd === 'report') report(a);
else if (cmd === 'revert') await revert(a);
else if (cmd === 'apply') applyOps();
else {
  console.error('사용: node scripts/kaggle.mjs pick <n> <빌드폴더> | collect <결과폴더> | calibrate <ids> <빌드폴더> | report <결과폴더> | revert <ids> | apply');
  process.exit(1);
}
