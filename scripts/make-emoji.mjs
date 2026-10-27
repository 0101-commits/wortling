// 보르티 이모티콘 8개 + 앱 아이콘을 Worker 의 POST /api/admin/draw(Workers AI FLUX.2 klein 4b, 무료)로 만든다
// (카드 그림과 같은 그림체, scripts/style.mjs). 준비물: .env(APP_URL · API_TOKEN).
// 실행: node scripts/make-emoji.mjs [이름…]   → public/emoji/<이름>.webp(256, 둥근 흰 원) · public/icons/*.png
//       node scripts/make-emoji.mjs --use hello=후보.png …   → 미리 그려 눈으로 고른 768² PNG 를 그대로 넣기(그리기 없음)
// 768×768 한 장 = 2.25칸 × 26.05 ≈ 59 뉴런. 이름을 주면 그것만 다시 만든다. 만든 뒤 배포해야 앱에 보인다.
// 그린 뒤 다리 수(앞발 둘 · 뒷발 둘)를 눈으로 확인할 것 — 10-14 판 hello 는 앞발 하나가 없어 「다리 3개」였다(2026-10-27).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { STYLE_INTRO, BORTI, STYLE, REF_NOTE, REF_FILE } from './style.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
const env = Object.fromEntries(
  (existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
const APP_URL = (process.env.APP_URL || env.APP_URL || '').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || env.API_TOKEN;

const POSES = {
  hello:
    'standing on both hind legs, waving hello with his right front paw raised high while his left front paw rests on his round belly, big friendly smile; clearly two front paws and two hind paws, four legs in total',
  happy: 'jumping with joy, both front paws raised high, eyes closed in a huge happy smile',
  sleep: 'curled up asleep on a small round cushion, wearing a tiny striped nightcap, peaceful closed eyes',
  party:
    'standing on both hind legs, wearing a tiny party hat, both front paws raised up cheering, colorful confetti falling around him; clearly two front paws and two hind paws, four legs in total',
  oops:
    'sitting with an embarrassed apologetic smile, his right front paw scratching the back of his head, his left front paw resting on the ground in front, both hind paws visible, a small sweat drop; four legs in total',
  study: 'wearing round glasses and reading an open book, curious focused look',
  mail: 'holding a white envelope with a red heart seal in both front paws, cheerful',
  think: 'tilting his head with one paw under his chin, curious thinking look',
};

const prompt = (pose) =>
  `${STYLE_INTRO} ${REF_NOTE} Emoticon sticker of Borti ${pose}. Full body, centered, filling most of the frame. ${BORTI} ${STYLE}`;
// 카드 그림과 같은 보르티(참고 그림 = 이모티콘 think 에서 뜸)
const ref = readFileSync(REF_FILE).toString('base64');

const args = process.argv.slice(2);
// --use 이름=파일.png : 고른 후보를 그대로 넣는다
const useAt = args.indexOf('--use');
const picked = new Map(
  useAt < 0
    ? []
    : args.slice(useAt + 1).map((x) => {
        const [n, f] = x.split('=');
        return [n, path.resolve(f)];
      }),
);
const names = picked.size ? [...picked.keys()] : args.length ? args : Object.keys(POSES);
if (!picked.size && (!APP_URL || !TOKEN)) throw new Error('.env 에 APP_URL · API_TOKEN 이 없다');
const unknown = names.filter((n) => !POSES[n]);
if (unknown.length) throw new Error(`모르는 이름: ${unknown.join(', ')} (있는 것: ${Object.keys(POSES).join(', ')})`);
mkdirSync(path.join(ROOT, 'public', 'emoji'), { recursive: true });
mkdirSync(path.join(ROOT, 'public', 'icons'), { recursive: true });

for (const name of names) {
  const p = prompt(POSES[name]);
  let png = picked.has(name) ? readFileSync(picked.get(name)) : undefined;
  for (let i = 0; i < 2 && !png; i++) {
    try {
      const res = await fetch(`${APP_URL}/api/admin/draw`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: p, width: 768, height: 768, ref }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      png = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.error(`${name} 다시 시도: ${String(e.message).slice(0, 120)}`);
    }
  }
  if (!png) { console.error(`${name} 실패`); continue; }
  // 둥근 원으로 오려 낸 256px(바깥은 투명)
  const size = 256;
  const circle = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);
  await sharp(png).resize(size, size).composite([{ input: circle, blend: 'dest-in' }]).webp({ quality: 85 }).toFile(path.join(ROOT, 'public', 'emoji', `${name}.webp`));
  if (name === 'hello') {
    // 앱 아이콘은 꽉 찬 네모(가장자리를 OS 가 둥글게 자름)
    for (const [f, s] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
      await sharp(png).resize(s, s).png().toFile(path.join(ROOT, 'public', 'icons', f));
    }
  }
  console.log(`이모티콘 ${name} 완료`);
}
