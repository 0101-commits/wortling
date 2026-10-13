// 바탕화면에 「Wortling 설정.html」 을 만든다. 더블클릭하면 접속 키가 붙은 설정 화면(#/setup)이 열린다.
// 키가 들어 있으니 이 PC 에만 둔다(저장소·공유 금지). 실행: npm run shortcut
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
if (!env.APP_URL || !env.API_TOKEN) throw new Error('.env 에 APP_URL · API_TOKEN 이 없다');

const url = `${env.APP_URL.replace(/\/$/, '')}/#/setup?k=${encodeURIComponent(env.API_TOKEN)}`;
const html = `<!doctype html><meta charset="utf-8"><title>Wortling 설정</title>
<meta http-equiv="refresh" content="0;url=${url}">
<p style="font:16px sans-serif">Wortling 설정 화면으로 이동 중… 안 열리면 <a href="${url}">여기</a>.</p>`;

const desktop =
  process.platform === 'win32'
    ? execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' }).trim()
    : path.join(process.env.HOME || '', 'Desktop');
const out = path.join(desktop, 'Wortling 설정.html');
writeFileSync(out, html, 'utf8');
console.log(`만듦: ${out}`);
if (process.argv.includes('--open')) {
  if (process.platform === 'win32') execFileSync('cmd', ['/c', 'start', '', out]);
}
