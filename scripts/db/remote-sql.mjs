// 원격 D1 에 일괄 SQL 을 보내기 전 관문(2026-10-30 D1 하루 읽기 500만 행 소진 사고 뒤).
// 같은 SQL 을 최신 백업의 로컬 사본(쓰기는 임시 복사본에만)에서 먼저 돌려 읽기량을 어림하고, 한도를 넘으면 원격 실행을 거절한다.
//   node scripts/db/remote-sql.mjs <파일.sql>
//   node scripts/db/remote-sql.mjs --command "UPDATE ..."
//   --force   한도를 넘어도 보낸다 · --limit N   한도 바꾸기(기본 200000 행)
//   --dry     어림만 하고 원격은 안 보낸다
// 읽은 행 수: wrangler --local 은 rows_read 를 안 줘서 가상기계 단계 수(scripts/db/steps.py) ÷ 4 로 어림한다.
//   전체 훑기는 한 행에 ≈4 단계, 색인 찾기는 더 들어서 어림값은 실제보다 크게 나온다(안전한 쪽).
import { copyFileSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openLocalDb, COPY_PATH } from './local-copy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
export const DEFAULT_LIMIT = 200_000;
export const STEPS_PER_ROW = 4;

/** 사본 복사본에서 sql 을 돌려 읽은 행 수 어림. 원본 사본은 건드리지 않는다 */
export function estimateRows(sql, { copy = COPY_PATH, python = 'python' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'worty-sql-'));
  try {
    const db = join(dir, 'try.sqlite');
    const file = join(dir, 'try.sql');
    copyFileSync(copy, db);
    writeFileSync(file, sql);
    const r = spawnSync(python, ['-I', join(HERE, 'steps.py'), db, file], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`로컬 시험 실행 실패: ${String(r.stderr || r.stdout).slice(0, 400)}`);
    return Math.ceil(JSON.parse(r.stdout).steps / STEPS_PER_ROW);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 한도 판단: { rows, allowed } — force 면 넘어도 allowed */
export function judge(rows, { limit = DEFAULT_LIMIT, force = false } = {}) {
  return { rows, limit, allowed: force || rows <= limit };
}

export function parseArgs(argv) {
  const o = { force: false, dry: false, limit: DEFAULT_LIMIT, file: null, command: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') o.force = true;
    else if (a === '--dry') o.dry = true;
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--command') o.command = argv[++i];
    else if (!a.startsWith('--')) o.file = a;
  }
  if (!o.file === !o.command) throw new Error('파일 하나 또는 --command 하나를 주세요');
  if (!(o.limit > 0)) throw new Error('--limit 은 양수');
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const sql = o.command ?? readFileSync(o.file, 'utf8');
  openLocalDb().close(); // 백업이 더 새것이면 사본을 다시 만든다
  const j = judge(estimateRows(sql), o);
  console.error(`로컬 시험: 읽은 행 어림 ${j.rows.toLocaleString()} (한도 ${j.limit.toLocaleString()})`);
  if (!j.allowed) {
    console.error('거절: 한도를 넘었다. 임시 표 상관 부질의면 색인을 먼저 만들거나 UPDATE ... FROM 으로 바꾼다. 그래도 보내려면 --force');
    process.exit(1);
  }
  if (o.dry) return;
  // 셸을 거치지 않고 wrangler 를 직접 불러 SQL 안의 따옴표·공백이 깨지지 않게 한다
  const args = [join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'execute', 'wortling', '--remote', ...(o.command ? ['--command', o.command] : ['--file', o.file])];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
}
