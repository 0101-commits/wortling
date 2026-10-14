// 보르티 이모티콘 8개 + 앱 아이콘을 Worker 의 POST /api/admin/draw(Workers AI FLUX.2 klein 4b, 무료)로 만든다
// (카드 그림과 같은 그림체, scripts/style.mjs). 준비물: .env(APP_URL · API_TOKEN).
// 실행: node scripts/make-emoji.mjs [이름…]   → public/emoji/<이름>.webp(256, 둥근 흰 원) · public/icons/*.png
// 768×768 한 장 = 2.25칸 × 26.05 ≈ 59 뉴런. 이름을 주면 그것만 다시 만든다. 만든 뒤 배포해야 앱에 보인다.
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { STYLE_INTRO, BORTI, STYLE } from './style.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
const APP_URL = (process.env.APP_URL || env.APP_URL || '').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || env.API_TOKEN;

const POSES = {
  hello: 'waving one front paw hello with a big friendly smile',
  happy: 'jumping with joy, both front paws raised high, eyes closed in a huge happy smile',
  sleep: 'curled up asleep on a small round cushion, wearing a tiny striped nightcap, peaceful closed eyes',
  party: 'wearing a tiny party hat, celebrating with colorful confetti falling around him',
  oops: 'sitting with an embarrassed apologetic smile, one paw scratching the back of his head, a small sweat drop',
  study: 'wearing round glasses and reading an open book, curious focused look',
  mail: 'holding a white envelope with a red heart seal in both front paws, cheerful',
  think: 'tilting his head with one paw under his chin, curious thinking look',
};

const prompt = (pose) =>
  `${STYLE_INTRO} Emoticon sticker of Borti ${pose}. Full body, centered, filling most of the frame. ${BORTI} ${STYLE}`;

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(POSES);
mkdirSync(path.join(ROOT, 'public', 'emoji'), { recursive: true });
mkdirSync(path.join(ROOT, 'public', 'icons'), { recursive: true });

for (const name of names) {
  const p = prompt(POSES[name]);
  let png;
  for (let i = 0; i < 2 && !png; i++) {
    try {
      const res = await fetch(`${APP_URL}/api/admin/draw`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: p, width: 768, height: 768 }),
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
