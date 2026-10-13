// 보르티 이모티콘 8개 + 앱 아이콘을 Higgsfield Z Image 로 만든다(카드 그림과 같은 3D 클레이 그림체).
// 실행: node scripts/make-emoji.mjs [이름…]   → public/emoji/<이름>.webp(256, 둥근 민트 원) · public/icons/*.png
// 장당 0.15크레딧. 이름을 주면 그것만 다시 만든다.
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HIGGS_JS = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@higgsfield', 'cli', 'bin', 'higgsfield.js');

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
  '3D clay render emoji sticker. Borti, a cute chubby cream dachshund puppy with a big round head, tiny body, ' +
  `big glossy eyes with highlights, rosy cheeks and brown floppy ears, ${pose}. ` +
  'Full body, centered, filling most of the frame, simple solid pastel mint background. ' +
  'Premium mascot quality, soft matte clay, Pixar-like softness, studio lighting, pastel colors. ' +
  'No text, letters, numbers, logos or speech bubbles.';

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(POSES);
mkdirSync(path.join(ROOT, 'public', 'emoji'), { recursive: true });
mkdirSync(path.join(ROOT, 'public', 'icons'), { recursive: true });

for (const name of names) {
  const p = prompt(POSES[name]);
  if (p.length > 780) throw new Error(`${name} 프롬프트 ${p.length}자 > 780(넘으면 job 이 실패함)`);
  let png;
  for (let i = 0; i < 2 && !png; i++) {
    try {
      const out = execFileSync(process.execPath, [HIGGS_JS, 'generate', 'create', 'z_image', '--aspect_ratio', '1:1', '--prompt', p, '--wait', '--wait-timeout', '5m', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 6 * 60 * 1000 });
      const j = [JSON.parse(out.slice(out.search(/[\[{]/)))].flat()[0];
      png = Buffer.from(await (await fetch(j.result_url || j.min_result_url)).arrayBuffer());
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
