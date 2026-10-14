// 정기 단어 업데이트(매주 일요일 05:30, 작업 스케줄러 「Wortling Words」 → scripts/register-task.ps1).
// 하는 일:
//   1) 원본 새로 받기 — 30일이 지났거나 --refresh 일 때. kaikki 4파일 · WordHoard csv zip · Goethe B1.
//      받은 파일이 이전의 50% 미만이면 버리고 이전 파일을 쓴다. DWDS 표제어 목록은 주소가 없어 그대로 둔다.
//   2) 씨앗 빌드(scripts/seed/build.mjs) → seed/words.json
//   3) 실서버에 이미 있는 단어 목록(GET /api/admin/keys)
//   4) words.json 가운데 DB 에 없고 keep 이 false 가 아닌 단어를 빌드 순서(B1 → B2 → C1, 빈도순)대로 고름
//   5) 한국어 뜻이 없는 단어는 claude -p 로 판정·채움(40개씩, 동시 3) → scripts/seed/data/content_auto_<KST 날짜>.json 에 덧붙임
//   6) keep 인 새 단어를 POST /api/admin/words/insert 로 200개씩 넣음(서버가 id·seq 를 이어 매기고 cards 도 만듦)
//   7) backup/words/<날짜>.json 에 보고를 남기고 디스코드로 알림
// 옵션: --dry(받기·claude·넣기 없이 수만 출력) · --refresh(30일과 상관없이 받기) · --max=N(한 번에 넣을 상한, 기본 1000) · --no-claude(뜻 없는 단어는 건너뜀)
// 되풀이해도 안전하다 — DB 에 있는 단어는 (lemma,pos)로 걸러 다시 넣지 않고, claude 결과는 파일에 남아 다음 빌드에도 쓰인다.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync, createWriteStream } from 'node:fs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOT = path.join(ROOT, '.data'); // 원본 자료(git 제외)
const SEED_DATA = path.join(ROOT, 'scripts', 'seed', 'data');
loadEnv(path.join(ROOT, '.env'));

const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || '';
const arg = (name) => process.argv.includes(name);
const DRY = arg('--dry');
const REFRESH = arg('--refresh');
const NO_CLAUDE = arg('--no-claude');
const MAX = Number((process.argv.find((a) => a.startsWith('--max=')) || '').slice(6)) || 1000;
const REFRESH_DAYS = 30;
const BATCH = 40; // claude 한 번에 넣을 단어 수
const PARALLEL = 3; // claude 동시 실행 수
const INSERT_BATCH = 200;
const CLAUDE_EXE =
  process.platform === 'win32'
    ? path.join(npmGlobalRoot(), '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    : 'claude';
const CLAUDE_ARGS = ['-p', '--output-format', 'json', '--model', 'sonnet', '--max-turns', '1', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
const FIELDS = ['lemma', 'pos', 'gender', 'plural', 'ipa', 'level', 'level_src', 'gloss_en', 'gloss_ko', 'gloss_status',
  'example_de', 'example_ko', 'example_src', 'scene_en', 'freq_rank'];
const keyOf = (w) => `${w.lemma.toLowerCase()}|${w.pos}`; // DB 와 비교할 때는 대소문자 무시(빌드도 같은 규칙으로 중복을 거름)

const day = kstDay();
const log = { day, started: new Date().toISOString(), dry: DRY, max: MAX, refresh: [], db: null, candidates: {}, filled: 0, rejected: 0, unfilled: 0, inserted: 0, byLevel: {}, ranges: [], errors: [] };

try {
  if (!APP_URL || !TOKEN) throw new Error('.env 에 APP_URL · API_TOKEN 이 없다');

  // 1) 원본 새로 받기
  await refreshSources();

  // 2) 빌드 → words.json
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'seed', 'build.mjs')], { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  if (b.status !== 0) throw new Error(`씨앗 빌드 실패: ${(b.stderr || b.stdout || '').slice(-500)}`);
  console.log((b.stdout.match(/^words .*$/m) || [''])[0]);
  const words = JSON.parse(readFileSync(path.join(ROOT, 'seed', 'words.json'), 'utf8'));

  // 3) 서버에 있는 단어
  let existing;
  try {
    const r = await api('/api/admin/keys'); // [{id, lemma, pos}] 또는 {items:[…]}
    existing = new Set((Array.isArray(r) ? r : r.items).map(keyOf));
    log.db = existing.size;
  } catch (e) {
    if (!DRY) throw e;
    // 시험(--dry) 때 서버 API 가 아직 없으면 원격에 넣어 둔 씨앗(B1·B2 keep)을 있는 것으로 본다
    existing = new Set(words.filter((w) => (w.level === 'B1' || w.level === 'B2') && w.keep === true).map(keyOf));
    log.db = `서버 목록 못 받음(${String(e.message).slice(0, 80)}) → 씨앗 B1·B2 ${existing.size}건을 있는 것으로 가정`;
  }
  console.log(`DB 단어: ${log.db}`);

  // 4) 새 단어 고르기 — words.json 은 이미 B1 → B2 → C1, 빈도순이다
  const fresh = words.filter((w) => w.keep !== false && !existing.has(keyOf(w)));
  const pick = fresh.slice(0, MAX);
  log.candidates = { total: fresh.length, picked: pick.length, byLevel: countBy(fresh, (w) => w.level), needText: pick.filter((w) => !w.gloss_ko).length };
  console.log(`새 후보 ${fresh.length}건 ${JSON.stringify(log.candidates.byLevel)} → 이번에 ${pick.length}건(상한 ${MAX}), 그중 한국어 뜻 없음 ${log.candidates.needText}건`);

  // 5) 한국어 뜻 채우기
  const need = pick.filter((w) => !w.gloss_ko);
  const got = new Map(); // key → claude 결과
  if (need.length && !DRY && !NO_CLAUDE) {
    const file = path.join(SEED_DATA, `content_auto_${day}.json`);
    const saved = new Map(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).map((c) => [c.key, c]) : []);
    const queue = [];
    for (let i = 0; i < need.length; i += BATCH) queue.push(need.slice(i, i + BATCH));
    let done = 0;
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      while (queue.length) {
        const batch = queue.shift();
        try {
          for (const c of await writeContent(batch)) { got.set(c.key, c); saved.set(c.key, c); }
          writeFileSync(file, JSON.stringify([...saved.values()], null, 1)); // 묶음마다 저장 — 중간에 멈춰도 남는다
        } catch (e) {
          log.errors.push(`claude 묶음 실패(${batch[0].lemma}…): ${String(e.message || e).slice(0, 200)}`);
        }
        console.log(`claude ${++done}/${Math.ceil(need.length / BATCH)}`);
      }
    }));
  }

  // 6) 넣을 줄 만들기: 뜻이 이미 있는 단어 + claude 가 keep 으로 채운 단어
  const items = [];
  for (const w of pick) {
    const k = `${w.lemma}|${w.pos}`;
    if (w.gloss_ko) { items.push(row(w)); continue; }
    const c = got.get(k);
    if (!c) { log.unfilled++; continue; }
    if (!c.keep) { log.rejected++; continue; }
    log.filled++;
    items.push(row({ ...w, gloss_ko: c.gloss_ko, example_de: c.example_de, example_ko: c.example_ko, example_src: 'gen', scene_en: c.scene_en, gloss_status: 'generated' }));
  }
  log.byLevel = countBy(items, (w) => w.level);
  if (DRY) {
    console.log(`[dry] 넣을 수 있는 단어 ${items.length}건 ${JSON.stringify(log.byLevel)} · claude 로 채울 단어 ${need.length}건(${Math.ceil(need.length / BATCH)}묶음, 건너뜀)`);
  } else {
    for (let i = 0; i < items.length; i += INSERT_BATCH) {
      const r = await api('/api/admin/words/insert', { method: 'POST', body: { items: items.slice(i, i + INSERT_BATCH) } });
      log.inserted += r.inserted;
      if (r.inserted) log.ranges.push(`${r.first_id}~${r.last_id}`); // 서버가 이미 있는 (lemma,pos)는 건너뛰므로 0건일 수 있다
    }
    console.log(`넣음 ${log.inserted}건 ${log.ranges.join(', ')} · claude 채움 ${log.filled} · 판정 제외 ${log.rejected} · 못 채움 ${log.unfilled}`);
    const extra = [
      `claude 채움 ${log.filled} · 판정 제외 ${log.rejected} · 못 채움 ${log.unfilled} · 남은 후보 ${fresh.length - pick.length}`,
      ...log.refresh.filter((s) => s.error).map((s) => `원본 받기 실패 ${s.name}: ${s.error.slice(0, 120)}`),
      ...log.errors.slice(0, 3),
    ].join('\n');
    notify('done', 'Wortling 단어 업데이트', `새 단어 ${log.inserted}개(C1 ${log.byLevel.C1 || 0})\n${extra}`);
  }
} catch (e) {
  log.error = String(e.stack || e);
  console.error(log.error);
  if (!DRY) notify('error', 'Wortling 단어 업데이트 실패', String(e.message || e).slice(0, 500));
  process.exitCode = 1;
} finally {
  log.finished = new Date().toISOString();
  const dir = path.join(ROOT, 'backup', 'words');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${day}${DRY ? '-dry' : ''}.json`), JSON.stringify(log, null, 2));
}

// ── 1) 원본 받기 ─────────────────────────────────────────────────────────────
async function refreshSources() {
  const kaikki = ['noun', 'verb', 'adj', 'adv'].map((p) => ({
    name: `kaikki ${p}`,
    file: path.join(DOT, 'kaikki', `de-${p}.jsonl`),
    url: async () => `https://kaikki.org/dictionary/German/pos-${p}/kaikki.org-dictionary-German-by-pos-${p}.jsonl`,
  }));
  const sources = [...kaikki, {
    name: 'WordHoard',
    file: path.join(DOT, 'wordhoard_csv.zip'),
    url: async () => {
      const rel = await (await fetch('https://api.github.com/repos/natema/wordhoard/releases/latest', { headers: { 'user-agent': 'wortling-update' } })).json();
      const a = (rel.assets || []).find((x) => /csv.*\.zip$/i.test(x.name));
      if (!a) throw new Error(`릴리스 ${rel.tag_name ?? '?'} 에 csv zip 이 없다`);
      return a.browser_download_url;
    },
    after: extractWordhoard,
  }, {
    name: 'Goethe B1',
    file: path.join(DOT, 'goethe_b1.json'),
    url: async () => 'https://www.dwds.de/api/lemma/goethe/B1.json',
    after: applyGoethe,
  }];
  for (const s of sources) {
    const age = existsSync(s.file) ? (Date.now() - statSync(s.file).mtimeMs) / 86_400_000 : Infinity;
    if (!REFRESH && age < REFRESH_DAYS) continue;
    if (DRY) { log.refresh.push({ name: s.name, skipped: `dry(받을 차례, ${Number.isFinite(age) ? Math.floor(age) + '일 지남' : '파일 없음'})` }); continue; }
    try {
      const size = await download(await s.url(), s.file);
      log.refresh.push({ name: s.name, size, note: s.after ? s.after(s.file) : '' });
    } catch (e) {
      log.refresh.push({ name: s.name, error: String(e.message || e).slice(0, 300) }); // 이전 파일로 계속
    }
  }
  if (log.refresh.length) console.log('원본:', JSON.stringify(log.refresh));
}

// 임시 파일로 받은 뒤 크기를 보고 바꾼다(이전의 50% 미만이면 버림)
async function download(url, file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const res = await fetch(url, { headers: { 'user-agent': 'wortling-update' }, signal: AbortSignal.timeout(60 * 60 * 1000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  return keepIfSane(tmp, file);
}
function keepIfSane(tmp, file) {
  const size = statSync(tmp).size;
  const prev = existsSync(file) ? statSync(file).size : 0;
  if (size < prev * 0.5) { unlinkSync(tmp); throw new Error(`크기 ${size} 가 이전 ${prev} 의 50% 미만 → 버리고 이전 파일 씀`); }
  renameSync(tmp, file);
  return size;
}

// zip 에서 wordhoard-de.csv 만 꺼내 빌드가 읽는 자리(scripts/seed/data)로 옮긴다. Windows 내장 tar(bsdtar)가 zip 을 푼다.
function extractWordhoard(zip) {
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', zip, '-C', DOT, 'wordhoard-de.csv'], { windowsHide: true });
  const out = path.join(SEED_DATA, 'wordhoard-de.csv');
  renameSync(path.join(DOT, 'wordhoard-de.csv'), `${out}.tmp`);
  return `wordhoard-de.csv ${keepIfSane(`${out}.tmp`, out)}B`;
}

// DWDS Goethe API → b1_goethe.json. 같은 표제어·품사의 동형어(#1, #2)는 첫 항목만 쓴다.
// 빌드가 쓰는 칸(표제어·품사·성)이 지금 파일과 같으면 손대지 않는다(2026-10-13 실측: 1,800건 일치).
function applyGoethe(file) {
  const P = { Verb: 'verb', Substantiv: 'noun', Adjektiv: 'adj', 'partizipiales Adjektiv': 'adj', Komparativ: 'adj', Adverb: 'adv', Pronominaladverb: 'adv',
    Konjunktion: 'conj', Präposition: 'prep', Demonstrativpronomen: 'pron', Indefinitpronomen: 'pron', Partikel: 'other', Interjektion: 'other', Mehrwortausdruck: 'phrase' };
  const seen = new Set();
  const conv = [];
  for (const a of JSON.parse(readFileSync(file, 'utf8'))) {
    const pos = P[a.pos];
    const lemma = a.sch?.[0]?.lemma;
    if (!pos || !lemma || seen.has(`${lemma}|${pos}`)) continue;
    seen.add(`${lemma}|${pos}`);
    conv.push({ lemma, pos, gender: a.articles?.[0] || null, variants: (a.sch || []).slice(1).map((s) => s.lemma), dwds: a.url });
  }
  const target = path.join(SEED_DATA, 'b1_goethe.json');
  const sig = (l) => new Set(l.map((w) => `${w.lemma}|${w.pos}|${w.gender}`));
  const before = sig(JSON.parse(readFileSync(target, 'utf8')));
  const after = sig(conv);
  const added = [...after].filter((x) => !before.has(x));
  const removed = [...before].filter((x) => !after.has(x));
  if (!added.length && !removed.length) return 'B1 목록 그대로';
  if (conv.length < before.size * 0.5) throw new Error(`Goethe B1 ${conv.length}건 — 이전 ${before.size}건의 50% 미만이라 쓰지 않음`);
  writeFileSync(target, JSON.stringify(conv, null, 1));
  return `B1 목록 바뀜 +${added.length} −${removed.length}: ${[...added.map((x) => '+' + x), ...removed.map((x) => '−' + x)].slice(0, 10).join(', ')}`;
}

// ── 5) claude -p 로 판정·채우기 (규칙 = content_b2 묶음 작업과 같음) ─────────────────────
async function writeContent(batch) {
  const list = batch.map((w) => ({ key: `${w.lemma}|${w.pos}`, lemma: w.lemma, pos: w.pos, gender: w.gender, level: w.level, gloss_en: w.gloss_en }));
  const prompt = `You write Korean learning content for German vocabulary (personal flashcard app "Wortling"; learner = Korean speaker moving from B1 to B2 and C1). Each item has its CEFR level. The list comes from a subtitle-frequency source, so some entries are not useful.
Return exactly one object per input item, same order, key copied unchanged.
- Useful word → {"key", "keep": true, "gloss_ko", "example_de", "example_ko", "scene_en"}
  · gloss_ko: 짧은 한국어 뜻 1~3개, 쉼표 구분, 20자 이내(명사는 관사 없이 명사형, 동사는 ~하다/되다 형, 형용사는 ~한/~적인 형, 부사는 ~게/~히 형). 오스트리아·스위스 어휘는 뜻에 (오) (스) 표기.
  · example_de: natural German sentence at the item's level, ≤70 chars, contains the headword (inflected/separated forms fine), everyday/work/news context.
  · example_ko: 자연스러운 한국어 번역, 40자 이내, ~해요체.
  · scene_en: ONE English line, ≤25 words, starting with "Borti " — a concrete visual scene where the mascot Borti (a chubby cream dachshund puppy with brown floppy ears) acts out the meaning with a concrete prop or action. No text, letters, numbers, signs, or logos. Only Borti unless a second character is needed ("another puppy"). Keep it gentle and family-friendly even for crime/violence words (show it symbolically: e.g. a detective magnifying glass, a broken vase).
- Not useful → {"key", "keep": false, "reason": "짧은 사유"}. Use false for: vulgar/sexual/slang words, proper names and nationality/ethnic labels, English loan slang typical of dubbed films (Bingo, Amigo), archaic words, very narrow jargon, words that only make sense in film dialogue (Samurai, Satan, Pirat). News/daily/work vocabulary is keep:true even if it is about crime or conflict (Mörder, Verhör, Haftbefehl). When unsure → true.
Output ONLY a JSON array (no prose, no code fence) with exactly ${list.length} objects.
Items: ${JSON.stringify(list)}`;
  const out = await runClaude(prompt);
  const text = String(JSON.parse(out).result ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let arr;
  try { arr = JSON.parse(text); } catch { throw new Error(`claude 결과가 JSON 이 아님: ${text.slice(0, 200)}`); }
  const keys = new Set(list.map((w) => w.key));
  const res = [];
  // 묶음 작업의 검증과 같은 조건을 통과한 것만 받는다. 나머지는 다음 실행 때 다시 채운다.
  for (const o of Array.isArray(arr) ? arr : []) {
    if (!o || !keys.has(o.key) || typeof o.keep !== 'boolean') continue;
    if (!o.keep) { res.push({ key: o.key, keep: false, reason: String(o.reason || '').slice(0, 60) || '(사유 없음)' }); continue; }
    const s = (v) => (typeof v === 'string' ? v.trim() : '');
    const c = { key: o.key, keep: true, gloss_ko: s(o.gloss_ko).slice(0, 40), example_de: s(o.example_de), example_ko: s(o.example_ko).slice(0, 80), scene_en: s(o.scene_en).slice(0, 300) };
    if (c.gloss_ko && c.example_de && c.example_de.length <= 70 && c.example_ko && c.scene_en.startsWith('Borti ')) res.push(c);
  }
  return res;
}

// daily.mjs 의 writeTextWithClaude 와 같은 claude.exe·플래그. 동시에 여럿 돌리려고 spawn 으로 기다린다.
function runClaude(input) {
  return new Promise((resolve, reject) => {
    const p = spawn(CLAUDE_EXE, CLAUDE_ARGS, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    p.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    const timer = setTimeout(() => p.kill(), 10 * 60 * 1000);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude -p 실패(${code}): ${(err || out).slice(0, 300)}`));
    });
    p.stdin.end(input);
  });
}

// ── Worker 관리 API (daily.mjs 와 같은 방식) ─────────────────────────────────
async function api(p, { method = 'GET', body } = {}) {
  const init = {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
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
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ── 잡동사니 ──────────────────────────────────────────────────────────────
function row(w) {
  return Object.fromEntries(FIELDS.map((f) => [f, w[f] ?? null]));
}
function countBy(list, f) {
  const o = {};
  for (const x of list) o[f(x)] = (o[f(x)] || 0) + 1;
  return o;
}
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
// daily.mjs 의 notifyError 와 같은 경로(AI_CLI 디스코드 알림). type 은 'done' · 'error'
function notify(type, title, desc) {
  const notifier = 'C:/Users/cgpar/AI_CLI/scripts/discord-notify.js';
  if (!existsSync(notifier)) return;
  try {
    spawnSync(process.execPath, [notifier, 'send'], { input: JSON.stringify({ type, title, desc, cli: 'claude' }), encoding: 'utf8', windowsHide: true, timeout: 20000 });
  } catch { /* 알림 실패는 무시 */ }
}
