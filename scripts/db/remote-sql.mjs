// 원격 앱 DB 에 일괄 SQL 을 보내는 유일한 길. wrangler.jsonc 의 DB_BACKEND 를 따른다:
//   pg(2026-10-30~, Supabase 스키마 worty) → ~/.secrets/worty-supabase.env 로 붙어 한 거래로 실행(Postgres 방언, 아래 어림 관문 없음)
//   d1 → 아래 관문을 거쳐 wrangler d1 execute
// D1 관문(2026-10-30 D1 하루 읽기 500만 행 소진 사고 뒤).
// 같은 SQL 을 최신 백업의 로컬 사본(쓰기는 임시 복사본에만)에서 먼저 돌려 읽기량을 어림하고, 한도를 넘으면 원격 실행을 거절한다.
//   node scripts/db/remote-sql.mjs <파일.sql>
//   node scripts/db/remote-sql.mjs --command "UPDATE ..."
//   --force   한도를 넘어도 보낸다 · --limit N   한도 바꾸기(기본 200000 행)
//   --dry     어림만 하고 원격은 안 보낸다
// 쓴 행도 같이 본다(무료 하루 10만 행): 5만 넘으면 거절.
// 읽은 행 수: wrangler --local 은 rows_read 를 안 줘서 가상기계 단계 수(scripts/db/steps.py) ÷ 4 로 어림한다.
//   전체 훑기는 한 행에 ≈4 단계, 색인 찾기는 더 들어서 어림값은 실제보다 크게 나온다(안전한 쪽).
import { copyFileSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openLocalDb, COPY_PATH } from './local-copy.mjs';
import { backend, openPg } from './pg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
export const DEFAULT_LIMIT = 200_000;
export const WRITE_LIMIT = 50_000; // D1 무료 쓰기는 하루 10만 행 — 한 번에 절반까지만
export const STEPS_PER_ROW = 4;

/** 사본 복사본에서 sql 을 돌려 읽은 행 수 어림. 원본 사본은 건드리지 않는다 */
export function estimate(sql, { copy = COPY_PATH, python = 'python' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'worty-sql-'));
  try {
    const db = join(dir, 'try.sqlite');
    const file = join(dir, 'try.sql');
    copyFileSync(copy, db);
    writeFileSync(file, sql);
    const r = spawnSync(python, ['-I', join(HERE, 'steps.py'), db, file], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`로컬 시험 실행 실패: ${String(r.stderr || r.stdout).slice(0, 400)}`);
    const j = JSON.parse(r.stdout);
    return { rows: Math.ceil(j.steps / STEPS_PER_ROW), writes: j.changes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 읽은 행 수만 필요할 때 */
export const estimateRows = (sql, opts) => estimate(sql, opts).rows;

/** 한도 판단: 읽기·쓰기 어느 쪽이든 넘으면 거절 — force 면 넘어도 allowed */
export function judge(rows, { limit = DEFAULT_LIMIT, force = false, writes = 0, writeLimit = WRITE_LIMIT } = {}) {
  return { rows, writes, limit, writeLimit, allowed: force || (rows <= limit && writes <= writeLimit) };
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

/** 앱 DB 가 Postgres(DB_BACKEND=pg)일 때: D1 읽기 한도와 상관없어 어림 관문 없이 한 거래로 보낸다(SQL 은 Postgres 방언이어야 한다) */
async function sendPg(sql, dry) {
  if (dry) return console.error('--dry: Postgres 로는 안 보냄');
  const pg = await openPg();
  try {
    const res = await pg.begin((tx) => tx.unsafe(sql));
    // 문장이 여럿이면 결과 배열의 배열, 하나면 결과 하나
    const list = res.length && Array.isArray(res[0]) ? res : [res];
    for (const r of list) console.error(`${r.command} ${r.count ?? r.length}`);
    const last = list[list.length - 1];
    if (last.length) console.log(JSON.stringify(last.slice(0, 50), null, 1));
  } finally {
    await pg.end();
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (backend() === 'pg') return sendPg(o.command ?? readFileSync(resolve(o.file), 'utf8'), o.dry);
  // 어림에 쓴 SQL 을 임시 파일에 한 번만 쓰고, 원격에도 바로 그 파일을 넘긴다(검사 뒤 원본이 바뀌는 틈 · 상대경로 혼동 방지)
  const dir = mkdtempSync(join(tmpdir(), 'worty-remote-'));
  try {
    const sql = o.command ?? readFileSync(resolve(o.file), 'utf8');
    const sent = join(dir, 'send.sql');
    writeFileSync(sent, sql);
    openLocalDb().close(); // 백업이 더 새것이면 사본을 다시 만든다
    const e = estimate(sql);
    const j = judge(e.rows, { limit: o.limit, force: o.force, writes: e.writes });
    console.error(`로컬 시험: 읽은 행 어림 ${j.rows.toLocaleString()} (한도 ${j.limit.toLocaleString()}) · 쓴 행 ${j.writes.toLocaleString()} (한도 ${j.writeLimit.toLocaleString()})`);
    if (!j.allowed) {
      console.error('거절: 한도를 넘었다. 임시 표 상관 부질의면 색인을 먼저 만들거나 UPDATE ... FROM 으로 바꾼다. 그래도 보내려면 --force');
      process.exit(1);
    }
    if (o.dry) return;
    // 셸을 거치지 않고 wrangler 를 직접 불러 SQL 안의 따옴표·공백이 깨지지 않게 한다
    const args = [join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'execute', 'wortling', '--remote', '--file', sent];
    const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String(e.message || e));
    process.exit(1);
  });
}
