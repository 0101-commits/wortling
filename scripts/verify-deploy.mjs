// 배포 점검(2026-10-30: Pages 를 dist 로 잘못 올려 /api/* 가 index.html 을 200 으로 돌려준 사고 뒤).
// 주소마다 「상태 200 + 내용 종류」를 본다 — 상태만 보면 HTML 이 API 자리에 와도 지나간다. 읽기 요청만.
// 쓰기: node scripts/verify-deploy.mjs              기본 두 주소(worty.pages.dev · workers.dev) 전부
//       node scripts/verify-deploy.mjs --app        APP_URL 하나만(Actions 용). 고장이면 디스코드 알림 한 번 + exit 1
//       node scripts/verify-deploy.mjs <주소> …      주소 지정
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { notify } from './admin.mjs'; // .env 를 읽는다(APP_URL · API_TOKEN)

export const BASES = ['https://worty.pages.dev', 'https://wortling.e-hcg.workers.dev'];
// [경로, 내용 종류에 들어 있어야 할 글]
export const CHECKS = [
  ['/', 'text/html'],
  ['/api/health', 'application/json'],
  ['/api/today', 'application/json'],
  ['/api/admin/keys', 'application/json'],
  ['/img/w0001.webp', 'image/webp'],
  ['/sw.js', 'javascript'],
];

// 매일 작업 첫 점검(--app)은 그림 경로를 빼고 본다 — 그림 하나가 바뀌어도 하루 작업이 통째로 멈추지 않게
export const APP_CHECKS = CHECKS.filter(([p]) => !p.startsWith('/img/'));

// 열쇠는 앱 주소(기본 두 곳 + APP_URL)에만 보낸다
const tokenHosts = () => new Set([...BASES, process.env.APP_URL || ''].filter(Boolean).map((u) => new URL(u).host));

/** 주소 하나 점검 → [{path, want, status, type, ok}] */
export async function verifyBase(base, token = process.env.API_TOKEN || '', checks = CHECKS) {
  const rows = [];
  const auth = token && tokenHosts().has(new URL(base).host) ? { authorization: `Bearer ${token}` } : {};
  for (const [p, want] of checks) {
    let status = 0;
    let type = '';
    try {
      const res = await fetch(base.replace(/\/$/, '') + p, { headers: auth, signal: AbortSignal.timeout(15_000) });
      status = res.status;
      type = (res.headers.get('content-type') || '').toLowerCase();
      await res.body?.cancel();
    } catch (e) {
      type = `연결 실패(${e.cause?.code || e.message})`;
    }
    rows.push({ path: p, want, status, type, ok: status === 200 && type.includes(want) });
  }
  return rows;
}

const show = (base, rows) => {
  console.log(`\n${base}`);
  for (const r of rows) console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.path.padEnd(18)} ${String(r.status || '-').padEnd(4)} ${r.type.slice(0, 40) || '-'}${r.ok ? '' : `  (기대 ${r.want})`}`);
};

/** 여러 주소를 점검해 표로 찍고, 전부 맞으면 true. 주소마다 재시도 없음 — 부르는 쪽이 필요하면 다시 */
export async function verify(bases, token, checks = CHECKS) {
  let all = true;
  const bad = [];
  for (const b of bases) {
    const rows = await verifyBase(b, token, checks);
    show(b, rows);
    for (const r of rows) if (!r.ok) (all = false), bad.push(`${b}${r.path} → ${r.status || '-'} ${r.type.slice(0, 30)}`);
  }
  return { ok: all, bad };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const app = args.includes('--app');
  const urls = args.filter((a) => !a.startsWith('--'));
  const bases = app ? [(process.env.APP_URL || '').replace(/\/$/, '')] : urls.length ? urls : BASES;
  if (bases.some((b) => !b)) {
    console.error('APP_URL 이 없다(.env 또는 Actions 비밀값)');
    process.exit(1);
  }
  if (!process.env.API_TOKEN) console.error('API_TOKEN 이 없어 /api/today · /api/admin/keys 는 실패한다(.env 또는 Actions 비밀값)');
  // --app 은 잠깐의 연결 끊김·깨어나는 지연으로 오보를 내지 않게 20초 간격 3번까지
  let { ok, bad } = await verify(bases, undefined, app ? APP_CHECKS : CHECKS);
  for (let i = 1; app && !ok && i < 3; i++) {
    console.error(`\n점검 실패 — 20초 뒤 다시(${i + 1}/3)`);
    await new Promise((r) => setTimeout(r, 20_000));
    ({ ok, bad } = await verify(bases, undefined, APP_CHECKS));
  }
  if (!ok) {
    console.error(`\n배포 점검 실패 ${bad.length}건`);
    if (app) await notify('error', '앱 주소 고장 — 배포 확인 필요', `${bases[0]} 점검 실패 ${bad.length}건 (첫째: ${bad[0]}). 오늘 작업은 건너뜀. 배포: npm run deploy`);
    process.exit(1);
  }
  console.log('\n배포 점검 통과');
}
