// PC 스크립트용 Postgres(Supabase 스키마 worty) 도우미 — 2026-10-30 앱 DB 를 D1 에서 옮긴 뒤.
//   backend()      wrangler.jsonc 의 DB_BACKEND(pg | d1) — 배포된 Worker 와 같은 쪽을 고른다
//   pgUrl()        연결 문자열: 환경 변수 WORTY_PG_URL, 없으면 ~/.secrets/worty-supabase.env (값은 찍지 않는다)
//   openPg()       postgres.js 연결(BIGINT·NUMERIC → 수)
//   dumpPg(file)   백업: D1 내보내기와 같은 꼴(SQLite CREATE + INSERT)로 쓴다 → local-copy.mjs 가 그대로 풀고 d1-to-pg.mjs 로 되살린다
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function backend() {
  const m = /"DB_BACKEND"\s*:\s*"(\w+)"/.exec(readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8'));
  return m?.[1] === 'pg' ? 'pg' : 'd1';
}

export function pgUrl() {
  if (process.env.WORTY_PG_URL) return process.env.WORTY_PG_URL;
  const file = join(homedir(), '.secrets', 'worty-supabase.env');
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('WORTY_PG_URL='));
  if (!line) throw new Error(`${file} 에 WORTY_PG_URL 이 없다`);
  return line.slice('WORTY_PG_URL='.length).trim();
}

export async function openPg() {
  const { default: postgres } = await import('postgres');
  return postgres(pgUrl(), {
    max: 1,
    fetch_types: false,
    onnotice: () => {},
    types: {
      int8: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) },
      numeric: { to: 1700, from: [1700], serialize: (x) => String(x), parse: (x) => Number(x) },
    },
  });
}

/** migrations/*.sql 을 빈 SQLite 에 적용해 얻은 CREATE 문(표 먼저, 색인 다음) — 백업 머리 */
export function sqliteSchema() {
  const db = new DatabaseSync(':memory:');
  const dir = join(ROOT, 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
  const rows = db.prepare("SELECT type, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'index', rowid").all();
  db.close();
  return rows.map((r) => `${r.sql};`);
}

const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** worty 스키마 전체를 file 로. 표마다 행 수를 돌려준다 */
export async function dumpPg(file, tables) {
  const sql = await openPg();
  const out = ['PRAGMA defer_foreign_keys=TRUE;', ...sqliteSchema()];
  const counts = {};
  try {
    await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
      for (const t of tables) {
        const rows = await tx.unsafe(`SELECT * FROM ${t} ORDER BY 1`);
        counts[t] = rows.length;
        const cols = rows.columns.map((c) => c.name);
        const head = `INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES(`;
        for (const r of rows) out.push(`${head}${cols.map((c) => lit(r[c])).join(',')});`);
      }
    });
  } finally {
    await sql.end();
  }
  writeFileSync(file, out.join('\n') + '\n');
  return counts;
}
