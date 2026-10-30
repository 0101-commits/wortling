// 배포는 이 명령 하나로: npm run deploy
// 빌드 → Worker(+화면 dist) → Pages 전달기(pages/) → 점검. 순서·산출물을 어기면 멈춘다.
// 2026-10-30 사고: Worker 를 화면 없이 올려 / 가 404, Pages 를 dist 로 올려 전달기가 없어 /api/* 가 index.html(200)을 돌려줬다.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASES, verify } from './verify-deploy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, cwd = ROOT) {
  console.log(`\n$ ${cmd}${cwd === ROOT ? '' : `   (${path.relative(ROOT, cwd)})`}`);
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) fail(`실패: ${cmd}`);
}
function fail(msg) {
  console.error(`\n배포 중단 — ${msg}`);
  process.exit(1);
}

run('npm run build');
if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) fail('dist/index.html 이 없다 — 화면 없이 Worker 를 올리면 / 가 404 가 된다');
run('npx wrangler deploy');
if (!existsSync(path.join(ROOT, 'pages', 'public', '_worker.js'))) fail('pages/public/_worker.js 가 없다 — 전달기 없이 Pages 를 올리면 /api/* 가 index.html 을 돌려준다');
// wrangler 4.149 는 --force 가 있어야 비대화형으로 올라간다
run('npx wrangler pages deploy --project-name worty --branch main --commit-dirty=true --force', path.join(ROOT, 'pages'));

// 퍼지는 데 걸리는 시간을 두고 몇 번 다시
let last;
for (let i = 1; i <= 5; i++) {
  console.log(`\n배포 점검(${i}/5)`);
  last = await verify(BASES);
  if (last.ok) break;
  if (i < 5) await new Promise((r) => setTimeout(r, 10_000));
}
if (!last.ok) fail(`점검 실패: ${last.bad.slice(0, 3).join(' · ')}`);
console.log('\n배포 완료 · 점검 통과');
