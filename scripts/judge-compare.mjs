// 그림 검사 AI 비교(2026-10-30 P2) — 같은 그림을 Groq · OpenRouter(모델마다) · Gemini(≤10번)로 판정해 맞는 정도를 표로 낸다.
// 앱 데이터는 읽기만(GET) 한다 — 올리기·지우기·상태 바꾸기 없음. 사용량은 임시 장부(.data/ledger.json 아님)에만 적는다.
// 사용: node scripts/judge-compare.mjs [n=20] [outDir=compare-out]   (APP_URL · API_TOKEN · GROQ_API_KEY · OPENROUTER_API_KEY · GEMINI_API_KEY)
// 그림: 올라간 그림(image_status ok) n장 + 검사 대기 그림 n장. 모델 목록은 OPENROUTER_MODEL(쉼표) 그대로.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { askGroqJson, askJson, askOpenRouterJson, OPENROUTER_MODELS, VISION_MODELS } from './ai.mjs';
import { buildPrompt, prepImages } from './judge.mjs';
import { emptyLedger, recordJudgeUsage } from './ledger.mjs';

const N = Number(process.argv[2]) || 20;
const OUT = process.argv[3] || 'compare-out';
const CHUNK = 3;
const GEMINI_MAX = 10; // 무료 몫 하루 약 20번 — 비교에는 10번까지
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || '';
if (!APP_URL || !TOKEN) throw new Error('APP_URL · API_TOKEN 이 없다');

const ledger = emptyLedger(); // 임시 장부 — 저장하지 않는다(요약에만 찍음)
const day = new Date().toISOString().slice(0, 10);
const usage = (p) => ({ tokens }) => recordJudgeUsage(ledger, day, p, tokens);

const get = async (p, bin = false) => {
  const res = await fetch(APP_URL + p, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}`);
  return bin ? Buffer.from(await res.arrayBuffer()) : res.json();
};
// 번호 매겨 고르게 n개(앞쪽만 몰리지 않게)
const spread = (list, n) => (list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]));

// ── 그림 모으기 ────────────────────────────────────────────────────────
const items = [];
const live = (await get('/api/admin/images')).items;
for (const w of spread(live, N)) {
  try {
    const png = Buffer.from(await (await fetch(`${APP_URL}/img/${w.id}.webp`)).arrayBuffer());
    items.push({ id: w.id, set: 'live', word: `${w.gender ? w.gender + ' ' : ''}${w.lemma}`, meaning_ko: w.gloss_ko, png });
  } catch (e) {
    console.error(`올라간 그림 ${w.id} 받기 실패: ${e.message}`);
  }
}
const pend = (await get('/api/admin/pending')).items;
for (const it of spread(pend, N)) {
  try {
    const w = (await get(`/api/word/${it.id}`)).word;
    items.push({ id: it.id, set: 'pending', word: `${w.gender ? w.gender + ' ' : ''}${w.lemma}`, meaning_ko: w.gloss_ko, png: await get(`/api/admin/pending/${it.id}`, true) });
  } catch (e) {
    console.error(`대기 그림 ${it.id} 받기 실패: ${e.message}`);
  }
}
console.log(`그림 ${items.length}장(올라간 ${items.filter((i) => i.set === 'live').length} · 대기 ${items.filter((i) => i.set === 'pending').length})`);

// ── 판정 ───────────────────────────────────────────────────────────────
// verdicts[provider][id] = {ok, why} · errors[provider] = [문구] · lat[provider] = 호출마다 초
const verdicts = {};
const errors = {};
const lat = {};
async function judgeWith(name, ask, list, chunk) {
  verdicts[name] = {};
  errors[name] = [];
  lat[name] = [];
  for (let s = 0; s < list.length; s += chunk) {
    const part = list.slice(s, s + chunk);
    const t0 = Date.now();
    try {
      const cards = part.map((it, i) => ({ n: i + 1, word: it.word, meaning_ko: it.meaning_ko }));
      const arr = await ask(buildPrompt(cards), await prepImages(part));
      lat[name].push({ sec: (Date.now() - t0) / 1000, images: part.length });
      for (const o of arr) {
        const it = part[Number(o?.n) - 1];
        if (it && typeof o.ok === 'boolean') verdicts[name][it.id] = { ok: o.ok, why: String(o.why ?? '').slice(0, 120) };
      }
      const miss = part.filter((it) => !verdicts[name][it.id]).length;
      if (miss) errors[name].push(`${part.map((i) => i.id).join(',')}: 판정 ${miss}장 빠짐`);
    } catch (e) {
      lat[name].push({ sec: (Date.now() - t0) / 1000, images: part.length, failed: true });
      errors[name].push(`${part.map((i) => i.id).join(',')}: ${String(e.message || e).slice(0, 150)}`);
    }
  }
}

await judgeWith('groq', (p, images) => askGroqJson(p, { images, onUsage: usage('groq') }), items, CHUNK);
for (const m of OPENROUTER_MODELS) {
  await judgeWith(`or:${m}`, (p, images) => askOpenRouterJson(p, { images, models: [m], onUsage: usage('openrouter') }), items, CHUNK);
}
// Gemini: 두 묶음에서 고르게 10장, 5장씩 두 번(한 번에 5장 = 요청 2번)
const gsample = [...spread(items.filter((i) => i.set === 'live'), 5), ...spread(items.filter((i) => i.set === 'pending'), 5)];
await judgeWith('gemini', (p, images) => askJson(p, { images, models: VISION_MODELS, onUsage: usage('gemini') }), gsample, Math.ceil(gsample.length / Math.min(GEMINI_MAX, 2)) || 1);

// ── 표 ─────────────────────────────────────────────────────────────────
const providers = Object.keys(verdicts);
const sym = (v) => (v ? (v.ok ? 'O' : 'X') : '-');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}% (${a}/${b})` : 'n/a');
const lines = [`# 그림 검사 AI 비교 (${new Date().toISOString()})`, '', `| 번호 | 묶음 | 단어 | ${providers.join(' | ')} |`, `|---|---|---|${providers.map(() => '---').join('|')}|`];
items.forEach((it, i) => lines.push(`| ${i + 1} ${it.id} | ${it.set} | ${it.word} | ${providers.map((p) => sym(verdicts[p][it.id])).join(' | ')} |`));
lines.push('', '## 판정 이유(서로 다른 것만)');
for (const it of items) {
  const vs = providers.map((p) => verdicts[p][it.id]).filter(Boolean);
  if (new Set(vs.map((v) => v.ok)).size > 1) lines.push(`- ${it.id} ${it.word} (${it.meaning_ko}): ${providers.map((p) => `${p}=${sym(verdicts[p][it.id])}「${verdicts[p][it.id]?.why ?? ''}」`).join(' · ')}`);
}
lines.push('', '## 일치율(Groq 기준 · 둘 다 판정한 그림만)', '', '| 비교 | 묶음 | 일치 | Groq ok 비율 | 상대 ok 비율 |', '|---|---|---|---|---|');
const summary = { n: items.length, agreement: {}, latency: {}, errors, ledger: ledger.days };
for (const p of providers.filter((x) => x !== 'groq')) {
  for (const set of ['live', 'pending', 'all']) {
    const both = items.filter((it) => (set === 'all' || it.set === set) && verdicts.groq[it.id] && verdicts[p][it.id]);
    const same = both.filter((it) => verdicts.groq[it.id].ok === verdicts[p][it.id].ok).length;
    const g = both.filter((it) => verdicts.groq[it.id].ok).length;
    const o = both.filter((it) => verdicts[p][it.id].ok).length;
    summary.agreement[`${p}/${set}`] = { agree: same, both: both.length };
    lines.push(`| ${p} | ${set} | ${pct(same, both.length)} | ${pct(g, both.length)} | ${pct(o, both.length)} |`);
  }
}
lines.push('', '## 지연·오류', '');
for (const p of providers) {
  const ok = lat[p].filter((l) => !l.failed);
  const avg = ok.length ? ok.reduce((a, l) => a + l.sec, 0) / ok.length : 0;
  const per = ok.length ? ok.reduce((a, l) => a + l.sec, 0) / ok.reduce((a, l) => a + l.images, 0) : 0;
  summary.latency[p] = { calls: lat[p].length, failed: lat[p].length - ok.length, avgCallSec: +avg.toFixed(1), perImageSec: +per.toFixed(1) };
  lines.push(`- ${p}: 호출 ${lat[p].length}번(실패 ${lat[p].length - ok.length}) · 평균 ${avg.toFixed(1)}초/호출 · ${per.toFixed(1)}초/장 · 판정 ${Object.keys(verdicts[p]).length}장`);
  for (const e of errors[p].slice(0, 8)) lines.push(`    - ${e}`);
}
lines.push('', `임시 장부(저장 안 함): ${JSON.stringify(ledger.days)}`);

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'table.md'), lines.join('\n'));
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ summary, items: items.map(({ png, ...r }) => ({ ...r, verdicts: Object.fromEntries(providers.map((p) => [p, verdicts[p][r.id] ?? null])) })) }, null, 1));
console.log(lines.join('\n'));
