// 그림 뜻 검사(2026-10-14 사용자 「그림이 단어 뜻과 안 이어진다」). 매일 작업(daily.mjs)이 올리기 전에 부른다.
// 그린 그림을 9장씩 번호(#n)만 붙인 모음 그림으로 만들고, AI(Gemini)가 그림을 받아 보며 단어·뜻과 맞는지 판정한다.
// 탈락이면 고친 장면(scene)도 받아 한 번 다시 그린다. AI 가 실패하면 판정 없음(빈 Map) → 부르는 쪽이 통과로 친다.
// 손 검사: node scripts/judge.mjs items.json   (items = [{id, word, meaning_ko, file}] → 줄마다 판정)
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { askJson } from './ai.mjs';

const TW = 400, TH = 300, LH = 28, COLS = 3, PER = 9;

async function sheets(items, dir) {
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (let p = 0; p * PER < items.length; p++) {
    const chunk = items.slice(p * PER, p * PER + PER);
    const comps = [];
    for (const [i, it] of chunk.entries()) {
      const x = (i % COLS) * TW, y = Math.floor(i / COLS) * (TH + LH);
      comps.push({ input: Buffer.from(`<svg width="${TW}" height="${LH}"><rect width="100%" height="100%" fill="#ddd"/><text x="8" y="21" font-family="Arial" font-size="20" font-weight="bold">#${p * PER + i + 1}</text></svg>`), left: x, top: y });
      comps.push({ input: await sharp(it.png).resize(TW, TH, { fit: 'contain', background: '#fff' }).png().toBuffer(), left: x, top: y + LH });
    }
    const f = path.join(dir, `judge-${Date.now()}-${p + 1}.png`);
    await sharp({ create: { width: TW * COLS, height: Math.ceil(chunk.length / COLS) * (TH + LH), channels: 3, background: '#fff' } }).composite(comps).png().toFile(f);
    files.push(f);
  }
  return files;
}

/** items: [{id, word, meaning_ko, png}] → Map(id → {ok, why, scene}) */
// 2026-10-16 사용자 「단어 자체를 그려야」 → 예문 없이 단어·뜻만 보고 판정한다.
export async function judgeImages(items, dir) {
  const out = new Map();
  if (!items.length) return out;
  const files = await sheets(items, dir);
  const cards = items.map((it, i) => ({ n: i + 1, word: it.word, meaning_ko: it.meaning_ko }));
  const prompt = `You check doodle pictures for German vocabulary flashcards (learner: Korean speaker). Each picture must illustrate the WORD ITSELF (its core meaning, like a picture dictionary), not a sentence or story. The attached images are contact sheets of these pictures (tiles labeled #n, in order).
Cards: ${JSON.stringify(cards)}
For EACH n decide "ok". ok=true only if a learner who sees the picture next to the word and its Korean meaning immediately connects them:
- the thing or action that stands for the WORD is actually drawn, large and clear (not missing, not tiny, not replaced by something else);
- abstract words (adverbs, particles, conjunctions…) pass when the situation, symbols and the puppy's pose/expression clearly show the concept of the meaning;
- the picture is not a specific story that needs a sentence to explain it;
- nothing in the picture contradicts the meaning.
Be strict: if the learner would have to guess why this picture fits the word, ok=false.
The puppy is the mascot Borti; style is not your concern, only meaning.
For ok=false also write "scene": a better ONE-line English scene, max 30 words, starting with "Borti": the key object or action first and large, at most 2 props, at most one other character (a puppy or kitten), at most one symbol (? ! heart, sweat drop, motion lines) and only when it carries the meaning, no letters or numbers.
Output ONLY a JSON array with exactly ${cards.length} items: [{"n":1,"ok":true,"why":"짧은 한국어 이유"}, {"n":2,"ok":false,"why":"…","scene":"Borti …"}]`;
  try {
    const arr = await askJson(prompt, { images: files });
    for (const o of arr) {
      const it = items[Number(o?.n) - 1];
      if (!it || typeof o.ok !== 'boolean') continue;
      const scene = typeof o.scene === 'string' && /\bBorti\b/.test(o.scene) ? o.scene.trim().slice(0, 300) : null;
      out.set(it.id, { ok: o.ok, why: String(o.why ?? '').slice(0, 120), scene });
    }
  } catch (e) {
    console.error(`뜻 검사 실패 — 판정 없이 진행: ${String(e.message || e).slice(0, 200)}`);
  } finally {
    for (const f of files) rmSync(f, { force: true });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const items = JSON.parse(readFileSync(process.argv[2], 'utf8')).map((it) => ({ ...it, png: readFileSync(it.file) }));
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.data', 'img-tmp');
  const res = await judgeImages(items, dir);
  for (const it of items) console.log(JSON.stringify({ id: it.id, word: it.word, ...(res.get(it.id) ?? { ok: null }) }));
}
