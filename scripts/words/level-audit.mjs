// 단어 등급 감사(읽기 전용) — 앱은 B1~C1 만 두기로 했는데, 등급표가 A1·A2·B1 → B1, C1·C2 → C1 로 뭉개져(lib.mjs cefr3) 진짜 등급이 가려졌다.
// 단어마다 둘째 의견을 모아 사용자가 지울 목록을 고르게 한다. 서버·D1 에는 아무것도 쓰지 않는다.
//   1) 단어 읽기: 관리 API /api/admin/words-export 질의 한 번(freq_rank·level_src 포함)
//   2) DAFlex: daflex_rob = nb_doc@등급 ≥ 2 인 첫 등급 · daflex_any = level_freq@등급 > 0 인 첫 등급
//   3) AI: Gemini Flash-Lite 50개씩(분당 12번 이하) → 모자라면 Groq. Flash(비 Lite)는 그림 검사 몫이라 쓰지 않는다.
// 결과: out/level-audit/words.json · summary.json (AI 답은 ai-cache.jsonl 에 쌓아 다시 돌려도 이어 한다)
// 사용: node scripts/words/level-audit.mjs [--limit N] [--no-ai]   시험: tests/level-audit.test.mjs
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, api, requireEnv } from '../admin.mjs';
import { askGroqJson } from '../ai.mjs';
import { DAFLEX_URL } from './sources.mjs';

export const OUT = path.join(ROOT, 'out', 'level-audit');
const CACHE = path.join(OUT, 'ai-cache.jsonl');
// Google 이 모델을 조용히 퇴역시킨다 → ai.mjs 와 같은 별칭(-latest). 바꾸려면 LEVEL_MODEL
export const MODEL = process.env.LEVEL_MODEL || 'gemini-flash-lite-latest';
export const BATCH = 50;
const GAP_MS = process.env.LEVEL_GAP_MS ? Number(process.env.LEVEL_GAP_MS) : 5_500; // 분당 11번(≤12)
const LV = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const CONF = ['high', 'mid', 'low'];
const UA = 'wortling-level-audit (personal vocabulary app; github.com/0101-commits/worty)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (w) => `${w.lemma}|${w.pos}`;

// ---------- 1) 단어 읽기 ----------

/** 관리 API 질의 한 번(/api/admin/words-export). 옛: wrangler d1 --remote 또는 /api/words 를 200개씩 넘김 → 쪽마다 표 전체를 읽어 D1 하루 한도를 먹었다 */
async function loadWords() {
  const r = await api('/api/admin/words-export');
  return r.items.map((x) => ({
    id: x.id, lemma: x.lemma, pos: x.pos, level: x.level, level_src: x.level_src ?? null, freq_rank: x.freq_rank ?? null,
    learned: Boolean(x.introduced_at) || x.state > 0 || x.reps > 0, reps: x.reps ?? 0, has_image: x.image_status === 'ok',
  }));
}

// ---------- 2) DAFlex ----------

const daflexKey = (lemma) => String(lemma).toLowerCase().replace(/^(der|die|das|sich)\s+/, '').trim();

/** DAFlex tsv → Map(열쇠 → {rob, any}). NE·FM 제외, 같은 열쇠 여러 줄(품사)이면 가장 이른 등급 */
export function parseDaflexRob(text) {
  const lines = String(text).split(/\r?\n/);
  const col = Object.fromEntries(lines[0].split('\t').map((h, i) => [h.replace(/"/g, ''), i]));
  const out = new Map();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const c = line.split('\t').map((x) => x.replace(/"/g, ''));
    if (c[col.tag] === 'NE' || c[col.tag] === 'FM') continue;
    const rob = LV.findIndex((lv) => Number(c[col[`nb_doc@${lv.toLowerCase()}`]]) >= 2);
    const any = LV.findIndex((lv) => Number(c[col[`level_freq@${lv.toLowerCase()}`]]) > 0);
    const k = daflexKey(c[col.word]);
    const o = out.get(k) ?? { rob: 99, any: 99 };
    out.set(k, { rob: Math.min(o.rob, rob < 0 ? 99 : rob), any: Math.min(o.any, any < 0 ? 99 : any) });
  }
  return new Map([...out].map(([k, o]) => [k, { rob: LV[o.rob] ?? null, any: LV[o.any] ?? null }]));
}

async function loadDaflex() {
  const file = path.join(OUT, 'DAFlex.tsv');
  if (!existsSync(file)) {
    const res = await fetch(DAFLEX_URL, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) throw new Error(`${res.status} ${DAFLEX_URL}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return parseDaflexRob(readFileSync(file, 'utf8'));
}

// ---------- 3) AI ----------

/** 배치 → 프롬프트. 번호는 배치 안 0부터 */
export function buildPrompt(batch) {
  const list = batch.map((w, i) => `${i}\t${w.lemma}\t${w.pos}`).join('\n');
  return `You are a CEFR expert for German as a foreign language. For each German word below (index, lemma, part of speech), estimate the CEFR level at which a learner of German typically learns this word, based on Goethe-Institut / telc word lists and Profile Deutsch. Use A1, A2, B1, B2, C1 or C2. Rare, technical or literary words that are on no learner list are C1 or C2.
Answer ONLY with a JSON array, one object per word, in this exact form:
[{"i":<index>,"lv":"A1|A2|B1|B2|C1|C2","conf":"high|mid|low"}]
"conf" is how sure you are. Every index must appear exactly once.

${list}`;
}

/** 응답 배열 → Map(번호 → {lv, conf}). 범위 밖 번호·모르는 등급은 버린다 */
export function validate(arr, n) {
  const got = new Map();
  for (const x of Array.isArray(arr) ? arr : []) {
    const i = Number(x?.i);
    const lv = String(x?.lv ?? '').toUpperCase();
    if (!Number.isInteger(i) || i < 0 || i >= n || !LV.includes(lv) || got.has(i)) continue;
    got.set(i, { lv, conf: CONF.includes(x.conf) ? x.conf : 'low' });
  }
  return got;
}

// parseJsonArray(ai.mjs)는 {id…}만 단일 객체로 감싸므로 {"i":…} 한 개짜리는 여기서 감싼다
function toArray(text) {
  for (const s of [text, text.slice(text.indexOf('['), text.lastIndexOf(']') + 1), text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') return 'i' in v ? [v] : Object.values(v).find(Array.isArray) ?? null;
    } catch { /* 다음 */ }
  }
  return null;
}

let last = 0;
/** Gemini 한 번(temperature 0). 시작 간격 GAP_MS 지킴. 429·503·5xx 는 1분 뒤 다시(다섯 번까지). 하루 몫 소진은 곧장 던진다(final) */
export async function askGemini(prompt) {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw Object.assign(new Error('GEMINI_API_KEY 가 없다'), { final: true });
  let err;
  for (let attempt = 1; attempt <= 5; attempt++) {
    await sleep(Math.max(0, last + GAP_MS - Date.now()));
    last = Date.now();
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': k },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
        signal: AbortSignal.timeout(3 * 60_000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = JSON.stringify(j.error?.details ?? '');
        throw Object.assign(new Error(`${res.status} ${String(j.error?.message || '').slice(0, 200)}`), { status: res.status, final: /PerDay/i.test(details) });
      }
      const c = j.candidates?.[0];
      const text = (c?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      const v = toArray(text);
      if (v) return v;
      throw new Error(`결과가 JSON 배열이 아님(${c?.finishReason || '?'}): ${text.slice(0, 120)}`);
    } catch (e) {
      err = e;
      console.error(`Gemini 실패(${MODEL} ${attempt}회): ${String(e.message).slice(0, 200)}`);
      if (e.final || (e.status >= 400 && e.status < 500 && e.status !== 429)) break;
      if (attempt < 5) await sleep(e.status === 429 || e.status === 503 ? 60_000 : 15_000);
    }
  }
  throw err;
}

/** 배치 하나 → Map(번호 → {lv, conf}). 빠진 번호는 두 번까지 다시 묻는다. ask = prompt → 배열 */
export async function classify(batch, ask) {
  const got = new Map();
  for (let round = 0; round < 3 && got.size < batch.length; round++) {
    const idx = batch.map((_, i) => i).filter((i) => !got.has(i));
    const sub = idx.map((i) => batch[i]);
    // 다시 물을 때도 원래 번호로 — 부분 목록을 새 번호로 매기면 섞일 수 있다
    const prompt = buildPrompt(sub).replace(/^(\d+)\t/gm, (_, n) => `${idx[Number(n)]}\t`);
    const r = validate(await ask(prompt), batch.length);
    for (const [i, v] of r) if (idx.includes(i)) got.set(i, v);
  }
  return got;
}

function readCache() {
  const m = new Map();
  if (!existsSync(CACHE)) return m;
  for (const line of readFileSync(CACHE, 'utf8').split('\n')) {
    try { const o = JSON.parse(line); m.set(o.k, { lv: o.lv, conf: o.conf }); } catch { /* 빈 줄·반쯤 쓴 줄 */ }
  }
  return m;
}

async function aiPass(words) {
  const done = readCache();
  const todo = words.filter((w) => !done.has(key(w)));
  console.error(`AI: 전체 ${words.length} · 이미 ${words.length - todo.length} · 남음 ${todo.length} (${Math.ceil(todo.length / BATCH)}묶음)`);
  let geminiFails = 0;
  const askGroq = (p) => askGroqJson(p);
  for (let b = 0; b < todo.length; b += BATCH) {
    const batch = todo.slice(b, b + BATCH);
    let got;
    // Gemini 가 연속 3묶음 실패하면 이 실행에서는 Groq 로
    if (geminiFails < 3) {
      try { got = await classify(batch, askGemini); geminiFails = 0; } catch (e) { geminiFails++; console.error(`묶음 ${b / BATCH + 1}: Gemini 포기 → Groq (${String(e.message).slice(0, 100)})`); }
    }
    if (!got) {
      try { got = await classify(batch, askGroq); } catch (e) { console.error(`묶음 ${b / BATCH + 1}: Groq 도 실패(${String(e.message).slice(0, 100)}) — 건너뜀`); continue; }
    }
    for (const [i, v] of got) {
      done.set(key(batch[i]), v);
      appendFileSync(CACHE, JSON.stringify({ k: key(batch[i]), ...v }) + '\n');
    }
    if (got.size < batch.length) console.error(`묶음 ${b / BATCH + 1}: ${batch.length - got.size}개 답 없음`);
    if (((b / BATCH) + 1) % 10 === 0) console.error(`AI ${Math.min(b + BATCH, todo.length)}/${todo.length}`);
  }
  return done;
}

// ---------- 요약 ----------

const inc = (o, ...ks) => { let t = o; for (const k of ks.slice(0, -1)) t = t[k] ??= {}; t[ks.at(-1)] = (t[ks.at(-1)] ?? 0) + 1; };

export function summarize(rows) {
  const s = { total: rows.length, ai_lv_by_level: {}, daflex_rob_by_ai_lv: {}, low_buckets: {} };
  for (const r of rows) {
    inc(s.ai_lv_by_level, r.ai_lv ?? 'none', r.level);
    inc(s.daflex_rob_by_ai_lv, r.daflex_rob ?? 'none', r.ai_lv ?? 'none');
    // A1·A2 일치 칸: 둘 다 A / AI 만 A / DAFlex 만 A
    const aiA = r.ai_lv === 'A1' || r.ai_lv === 'A2';
    const dfA = r.daflex_rob === 'A1' || r.daflex_rob === 'A2';
    if (!aiA && !dfA) continue;
    const b = (s.low_buckets[aiA && dfA ? 'both_A' : aiA ? 'ai_only_A' : 'daflex_only_A'] ??= { n: 0, learned: 0, has_image: 0 });
    b.n++;
    if (r.learned) b.learned++;
    if (r.has_image) b.has_image++;
  }
  return s;
}

// ---------- 실행 ----------

async function main() {
  const args = process.argv.slice(2);
  const noAi = args.includes('--no-ai');
  const li = args.indexOf('--limit');
  const limit = li >= 0 ? Number(args[li + 1]) : 0;
  mkdirSync(OUT, { recursive: true });

  requireEnv();
  let words = await loadWords();
  console.error(`단어 ${words.length}개 읽음(관리 API words-export)`);
  if (limit > 0) words = words.slice(0, limit);

  const daflex = await loadDaflex();
  const ai = noAi ? new Map() : await aiPass(words);

  const rows = words.map((w) => {
    const d = daflex.get(daflexKey(w.lemma));
    const a = ai.get(key(w));
    return {
      id: w.id, lemma: w.lemma, pos: w.pos, level: w.level, level_src: w.level_src, freq_rank: w.freq_rank, learned: w.learned, reps: w.reps, has_image: w.has_image,
      daflex_rob: d?.rob ?? null, daflex_any: d?.any ?? null, ai_lv: a?.lv ?? null, ai_conf: a?.conf ?? null,
    };
  });
  writeFileSync(path.join(OUT, 'words.json'), JSON.stringify(rows));
  const summary = summarize(rows);
  writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
}
