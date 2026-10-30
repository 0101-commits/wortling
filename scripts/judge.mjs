// 그림 뜻 검사(2026-10-14 사용자 「그림이 단어 뜻과 안 이어진다」). 매일 작업(daily.mjs)이 올리기 전에 부른다.
// 그림마다 「#n」 글 조각 + 그림(768×576)을 차례로 붙여 AI가 단어·뜻과 맞는지 판정한다.
// 2026-10-19 사용자 「강아지 다리가 5개 같은 오류」 → 몸 구조(다리·귀·꼬리 수, 붙은 몸)도 본다. 다리를 세려면 모음 그림(9칸 400×300)은
// 작아서 한 장씩 따로 보낸다(모음 그림은 claude Read 도구 시절에 파일 하나로 묶으려던 것).
// 탈락이면 고친 장면(scene)도 받아 한 번 다시 그린다.
// AI 가 실패하면 null(판정 못 함). 예전엔 빈 Map = 통과였는데 그러면 몸 구조 오류가 검사 없이 올라간다 → 부르는 쪽이 올리지 않고 「검사 대기」로 맡긴다(daily.mjs).
// 모델은 Flash 만(ai.mjs VISION_MODELS) — 무료 몫이 하루 약 20번이라 글·장면 일은 Flash-Lite 로 뺐다.
// 2026-10-29 Groq 폴백(Flash 가 503/timeout 으로 이틀째 맛 감) → 2026-10-30 순서를 뒤집어 Groq(qwen3-vl, 3장씩) 먼저, 판정 못 받은 그림만 Gemini Flash. 판정 일부만 와도 온 것만 쓴다(빠진 것은 대기에 남음).
// 그림은 긴 변 512 로 줄여 보낸다(토큰 절약). 사용량·손 실행 예약은 ledger.mjs.
// 손 검사: node scripts/judge.mjs items.json   (items = [{id, word, meaning_ko, file}] → 줄마다 판정)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { VISION_MODELS, askJson, askGroqJson } from './ai.mjs';
import { judgeAllowed, recordJudgeUsage } from './ledger.mjs';

// Groq 는 한 번에 이미지 3장까지(Groq 공식 문서)
const GROQ_CHUNK = 3;

// 2026-10-16 사용자 「단어 자체를 그려야」 → 예문 없이 단어·뜻만 보고 판정한다.
export function buildPrompt(cards) {
  return `You check doodle pictures for German vocabulary flashcards (learner: Korean speaker). Each picture must illustrate the WORD ITSELF (its core meaning, like a picture dictionary), not a sentence or story. Each attached picture follows its label #n.
Cards: ${JSON.stringify(cards)}
For EACH n decide "ok". ok=true only if a learner who sees the picture next to the word and its Korean meaning immediately connects them:
- the thing or action that stands for the WORD is actually drawn, large and clear (not missing, not tiny, not replaced by something else);
- abstract words (adverbs, particles, conjunctions…) pass when the situation, symbols and the puppy's pose/expression clearly show the concept of the meaning;
- the picture is not a specific story that needs a sentence to explain it;
- nothing in the picture contradicts the meaning.
Be strict: if the learner would have to guess why this picture fits the word, ok=false.
ALSO check every animal's BODY (the puppy is the mascot Borti; another puppy or kitten may appear). Before deciding, count each animal's legs/paws, ears, eyes, tails and heads one by one. ok=false if any animal has: more than four legs or paws, an extra or missing head, ear, eye or tail, a limb growing from the wrong place, floating or detached body parts, bodies merged with each other or with an object, or Borti drawn twice. Borti must show all four legs (two front paws and two hind paws): ok=false when one is missing, even if it could be "hidden behind his own body" — only a separate object (box, blanket, desk, door, another character) may cover a leg, or a curled-up sleeping pose. Extra legs are never fine. When the body is wrong, "why" names it (e.g. "다리가 3개", "다리가 5개").
Line style and colors are not your concern; only meaning and correct bodies.
For ok=false also write "scene": a better ONE-line English scene, max 30 words, starting with "Borti": the key object or action first and large, at most 2 props, at most one other character (a puppy or kitten), at most one symbol (? ! heart, sweat drop, motion lines) and only when it carries the meaning, no letters or numbers. If the body was wrong, keep the idea but use a simpler pose with fewer overlapping limbs (Borti sitting or standing still, front view, all four paws visible, at most one paw raised).
Output ONLY a JSON array with exactly ${cards.length} items: [{"n":1,"ok":true,"why":"짧은 한국어 이유"}, {"n":2,"ok":false,"why":"…","scene":"Borti …"}]`;
}

// 검사 AI 에 보내는 그림 크기(긴 변). 작을수록 토큰이 준다(Groq 하루 토큰 한도) — JUDGE_MAX_SIDE 로 바꿈, 기본 512
const MAX_SIDE = Number(process.env.JUDGE_MAX_SIDE) || 512;

async function prepImages(items) {
  const images = [];
  for (const [i, it] of items.entries()) images.push({ label: `#${i + 1}`, png: await sharp(it.png).resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', background: '#fff' }).flatten({ background: '#fff' }).png().toBuffer() });
  return images;
}

function applyResults(out, items, arr) {
  let n = 0;
  for (const o of arr) {
    const it = items[Number(o?.n) - 1];
    if (!it || typeof o.ok !== 'boolean') continue;
    const scene = typeof o.scene === 'string' && /\bBorti\b/.test(o.scene) ? o.scene.trim().slice(0, 300) : null;
    out.set(it.id, { ok: o.ok, why: String(o.why ?? '').slice(0, 120), scene });
    n++;
  }
  return n;
}

// 장부(ledger.mjs) 연결 — daily.mjs 가 켠다. 켜면 검사 AI 사용량을 적고, 손 실행은 예약 실행 몫을 건드리기 전에 멈춘다. 안 켜면(손 검사 CLI · 시험) 그대로 부른다
let usage = null;
/** ctx = {ledger, cfg, day: () => 'YYYY-MM-DD'(UTC), save?: () => void} · null 이면 끔 */
export function setJudgeLedger(ctx) {
  usage = ctx;
}
const allowed = (p) => !usage || judgeAllowed(usage.ledger, usage.day(), p, usage.cfg);
const noteUsage = (p) => ({ tokens }) => {
  if (!usage) return;
  recordJudgeUsage(usage.ledger, usage.day(), p, tokens);
  usage.save?.();
};

// 검사 AI 하나. todo = 아직 판정 못 받은 그림 → 받은 만큼 out 에 채운다. 막히면 던지거나 0장
const PROVIDERS = {
  async groq(todo, out) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY 없음');
    let ok = 0;
    for (let s = 0; s < todo.length; s += GROQ_CHUNK) {
      const chunk = todo.slice(s, s + GROQ_CHUNK);
      if (!allowed('groq')) {
        console.error('Groq 하루 몫 예약분 — 손 실행은 여기서 멈춤(나머지는 다음에)');
        break;
      }
      try {
        const cc = chunk.map((it, i) => ({ n: i + 1, word: it.word, meaning_ko: it.meaning_ko }));
        const arr = await askGroqJson(buildPrompt(cc), { images: await prepImages(chunk), onUsage: noteUsage('groq') });
        ok += applyResults(out, chunk, arr);
      } catch (e) {
        console.error(`Groq 청크 실패(나머지는 다음에): ${String(e.message || e).slice(0, 150)}`);
        break;
      }
    }
    return ok;
  },
  async gemini(todo, out) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 없음');
    if (!allowed('gemini')) throw new Error('Gemini 하루 몫 예약분 — 손 실행은 부르지 않음');
    const cards = todo.map((it, i) => ({ n: i + 1, word: it.word, meaning_ko: it.meaning_ko }));
    const arr = await askJson(buildPrompt(cards), { images: await prepImages(todo), models: VISION_MODELS, onUsage: noteUsage('gemini') });
    return applyResults(out, todo, arr);
  },
};

/** 부르는 차례(JUDGE_ORDER 환경값, 쉼표 구분). 기본 groq → gemini */
const order = () => String(process.env.JUDGE_ORDER || 'groq,gemini').split(',').map((s) => s.trim()).filter((p) => PROVIDERS[p]);

/** items: [{id, word, meaning_ko, png}] → Map(id → {ok, why, scene}) · AI 실패면 null. png 는 PNG·JPEG·WebP 버퍼 무엇이든
 *  2026-10-30 Groq 먼저(Gemini Flash 는 하루 ≈20번에 503 도 잦다) → 판정을 못 받은 그림만 다음 AI 로. 오류 없이 빈 답이 와도(0장 적용) 실패로 보고 넘어간다 */
export async function judgeImages(items) {
  const out = new Map();
  if (!items.length) return out;
  for (const p of order()) {
    const todo = items.filter((it) => !out.has(it.id));
    if (!todo.length) break;
    try {
      const n = await PROVIDERS[p](todo, out);
      if (n === 0) throw new Error('쓸 수 있는 판정을 하나도 안 줌');
      console.log(`그림 검사 ${p} ${n}/${todo.length}장`);
    } catch (e) {
      console.error(`그림 검사 실패(${p}): ${String(e.message || e).slice(0, 200)}`);
    }
  }
  return out.size ? out : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('./admin.mjs'); // .env 를 읽는다(GEMINI_API_KEY)
  const items = JSON.parse(readFileSync(process.argv[2], 'utf8')).map((it) => ({ ...it, png: readFileSync(it.file) }));
  const res = await judgeImages(items);
  for (const it of items) console.log(JSON.stringify({ id: it.id, word: it.word, ...(res?.get(it.id) ?? { ok: null }) }));
}
