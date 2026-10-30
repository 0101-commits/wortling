#!/usr/bin/env node
// D1 덤프 → Postgres(Supabase 스키마 worty) 이관. AI_CLI/worker/scripts/d1-to-pg.mjs 를 worty 표에 맞춘 것.
//
//   npx wrangler d1 export wortling --remote --output=worty-d1.sql   (D1 읽기 한도가 넘쳐도 된다 — 10-30 실측)
//   node scripts/db/d1-to-pg.mjs --schema                 스키마만(scripts/db/schema.pg.sql, 몇 번 돌려도 안전)
//   node scripts/db/d1-to-pg.mjs --schema worty-d1.sql    스키마 + 행 옮기기 + 표마다 행 수 대조
//
// 연결: 환경 변수 WORTY_PG_URL, 없으면 ~/.secrets/worty-supabase.env 의 WORTY_PG_URL(역할 worty_app, 검색 경로 worty) — scripts/db/pg.mjs.
// 매일 백업(backup/YYYY-MM-DD.sql.gz, pg.mjs dumpPg)도 같은 꼴이라 이 스크립트로 되살린다(gz 는 먼저 풀 것).
// - 덤프의 INSERT 만 읽는다. CREATE·PRAGMA·d1_migrations·sqlite_sequence 의 행은 옮기지 않는다(시퀀스 값만 참고).
// - 몇 번 돌려도 안전하다: 이미 있는 행은 ON CONFLICT DO NOTHING 으로 건너뛴다.
// - AUTOINCREMENT 표는 id 를 그대로 넣고 시퀀스를 max(id, sqlite_sequence) + 1 로 맞춘다(지운 번호를 다시 쓰지 않게 — SQLite 와 같다).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openPg } from './pg.mjs';

/** 외래 키 순서(words 먼저). identity = AUTOINCREMENT 였던 칸 */
export const TABLES = {
  words: {},
  cards: {},
  reviews: { identity: 'id' },
  notifications: { identity: 'id' },
  settings: {},
  word_changes: { identity: 'id' },
  word_reports: { identity: 'id' },
  word_requests: { identity: 'id' },
  news_days: {},
  word_skips: {},
  day_plans: {},
  practice: { identity: 'id' },
};
/** 옮기지 않는 표(행 수만 알린다) */
const SKIP = new Set(['d1_migrations', 'sqlite_sequence', 'read_budget', '_cf_KV', '_cf_METADATA']);

// 따옴표 밖의 ; 에서 문장을 자른다. 문자열 안의 ; · 줄바꿈은 그대로 둔다.
function statements(sql) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    if (ch === ';' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

const skipWs = (s, i) => {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
};

// SQLite 식 하나 — 문자열·숫자·NULL·char(n)·replace(a,b,c)·unistr·`||` 이음. D1 export 가 줄바꿈을 이렇게 내보낸다.
function expr(s, i) {
  i = skipWs(s, i);
  let v;
  let m;
  if (s[i] === "'") {
    let j = i + 1;
    let str = '';
    for (;; j++) {
      if (j >= s.length) throw new Error('닫히지 않은 문자열');
      if (s[j] === "'") {
        if (s[j + 1] === "'") {
          str += "'";
          j++;
        } else break;
      } else str += s[j];
    }
    v = str;
    i = j + 1;
  } else if ((m = /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(s.slice(i, i + 40)))) {
    v = /^[-+]?\d+$/.test(m[0]) && !Number.isSafeInteger(Number(m[0])) ? m[0] : Number(m[0]);
    i += m[0].length;
  } else if (/^NULL\b/i.test(s.slice(i, i + 5))) {
    v = null;
    i += 4;
  } else if ((m = /^(\w+)\s*\(/.exec(s.slice(i, i + 40)))) {
    const fn = m[1].toLowerCase();
    i += m[0].length;
    const args = [];
    for (;;) {
      let a;
      [a, i] = expr(s, i);
      args.push(a);
      i = skipWs(s, i);
      if (s[i] === ',') {
        i++;
        continue;
      }
      if (s[i] === ')') {
        i++;
        break;
      }
      throw new Error(`함수 인자 해석 실패: ${s.slice(i, i + 20)}`);
    }
    if (fn === 'char') v = String.fromCharCode(...args);
    else if (fn === 'replace') v = String(args[0]).split(String(args[1])).join(String(args[2]));
    else throw new Error(`지원하지 않는 함수: ${fn}`);
  } else {
    throw new Error(`해석할 수 없는 값: ${s.slice(i, i + 20)}`);
  }
  i = skipWs(s, i);
  if (s.startsWith('||', i)) {
    let rest;
    [rest, i] = expr(s, i + 2);
    v = String(v) + String(rest);
  }
  return [v, i];
}

// 문장 하나가 INSERT 면 { table, cols, rows } 로.
function parseInsert(stmt) {
  const head = /^INSERT\s+INTO\s+"?(\w+)"?\s*(?:\(([^)]*)\))?\s*VALUES\s*/i.exec(stmt);
  if (!head) return null;
  const cols = head[2] ? head[2].split(',').map((c) => c.trim().replace(/^"|"$/g, '')) : null;
  const rows = [];
  let i = head[0].length;
  for (;;) {
    i = skipWs(stmt, i);
    if (stmt[i] !== '(') throw new Error(`VALUES 해석 실패: ${stmt.slice(i, i + 20)}`);
    i++;
    const row = [];
    for (;;) {
      let v;
      [v, i] = expr(stmt, i);
      row.push(v);
      i = skipWs(stmt, i);
      if (stmt[i] === ',') {
        i++;
        continue;
      }
      if (stmt[i] === ')') {
        i++;
        break;
      }
      throw new Error(`값 목록 해석 실패: ${stmt.slice(i, i + 20)}`);
    }
    rows.push(row);
    i = skipWs(stmt, i);
    if (stmt[i] === ',') {
      i++;
      continue;
    }
    break;
  }
  return { table: head[1], cols, rows };
}

/** 덤프 → { tables: {표: [행 객체]}, seqs: {표: sqlite_sequence 값}, skipped: {표: 행 수} } */
export function parseDump(sql) {
  const tables = {};
  const seqs = {};
  const skipped = {};
  for (const st of statements(sql)) {
    const ins = parseInsert(st);
    if (!ins) continue;
    if (ins.table === 'sqlite_sequence') {
      for (const r of ins.rows) {
        const o = Object.fromEntries((ins.cols ?? ['name', 'seq']).map((c, k) => [c, r[k]]));
        seqs[o.name] = Number(o.seq);
      }
    }
    if (!TABLES[ins.table]) {
      skipped[ins.table] = (skipped[ins.table] || 0) + ins.rows.length;
      if (!SKIP.has(ins.table)) throw new Error(`모르는 표 ${ins.table} — schema.pg.sql 과 TABLES 에 더할 것`);
      continue;
    }
    if (!ins.cols) throw new Error(`${ins.table}: 칸 이름 없는 INSERT — wrangler d1 export 로 다시 받을 것`);
    for (const r of ins.rows) {
      if (r.length !== ins.cols.length) throw new Error(`${ins.table}: 값 ${r.length}개 ≠ 칸 ${ins.cols.length}개`);
      (tables[ins.table] ||= []).push(Object.fromEntries(ins.cols.map((c, k) => [c, r[k]])));
    }
  }
  return { tables, seqs, skipped };
}

const CHUNK = 400; // 한 INSERT 의 줄 수(자리표시자 ≤ 65535: 25칸 × 400 = 1만)

/** db = { query(text, params) → 행 배열 }. 표마다 { table, dump, before, inserted, after } */
export async function migrate(sql, db, log = console.log) {
  const { tables, seqs, skipped } = parseDump(sql);
  const count = async (t) => Number((await db.query(`SELECT count(*) AS n FROM ${t}`, []))[0].n);
  const colsOf = async (t) => (await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [t])).map((r) => r.column_name);
  const report = [];
  for (const [t, { identity }] of Object.entries(TABLES)) {
    const rows = tables[t] || [];
    const known = new Set(await colsOf(t));
    if (!known.size) throw new Error(`Postgres 에 표 ${t} 가 없다 — --schema 먼저`);
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    for (const c of cols) if (!known.has(c)) throw new Error(`${t}: Postgres 에 없는 칸 ${c} — schema.pg.sql 확인`);
    const before = await count(t);
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const params = [];
      const values = part.map((r) => `(${cols.map((c) => `$${params.push(r[c] ?? null)}`).join(', ')})`);
      const text = `INSERT INTO ${t} (${cols.join(', ')}) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING RETURNING 1`;
      inserted += (await db.query(text, params)).length;
    }
    // id 를 그대로 넣었으니 시퀀스를 옮겨야 이후 INSERT 가 겹치지 않는다. SQLite AUTOINCREMENT 처럼 지운 번호도 다시 안 쓴다
    if (identity) {
      await db.query(
        `SELECT setval(pg_get_serial_sequence('${t}', '${identity}'), GREATEST(COALESCE((SELECT MAX(${identity}) FROM ${t}), 0), $1::bigint) + 1, false)`,
        [seqs[t] ?? 0],
      );
    }
    const after = await count(t);
    report.push({ table: t, dump: rows.length, before, inserted, after });
    log(`${t.padEnd(14)} 덤프 ${String(rows.length).padStart(6)} · 이관 전 ${String(before).padStart(6)} · 새로 넣음 ${String(inserted).padStart(6)} · 이관 후 ${String(after).padStart(6)}`);
  }
  for (const [t, n] of Object.entries(skipped)) log(`건너뜀: ${t} ${n}행 (이관 대상 아님)`);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const schema = args.includes('--schema');
  const file = args.find((a) => !a.startsWith('--'));
  if (!schema && !file) {
    console.error('사용법: node scripts/db/d1-to-pg.mjs [--schema] [덤프.sql]');
    process.exit(2);
  }
  const sql = await openPg();
  try {
    const [{ search_path: sp, current_user: who }] = await sql`SELECT current_setting('search_path') AS search_path, current_user`;
    console.log(`연결: ${who} · 검색 경로 ${sp}`);
    if (!/^"?worty"?$/.test(sp.trim())) throw new Error('검색 경로가 worty 가 아니다 — worty_app 으로 붙었는지 확인');
    if (schema) {
      await sql.unsafe(readFileSync(new URL('./schema.pg.sql', import.meta.url), 'utf8'));
      console.log('스키마 적용: scripts/db/schema.pg.sql');
    }
    if (file) await migrate(readFileSync(file, 'utf8'), { query: (text, params) => sql.unsafe(text, params) });
  } finally {
    await sql.end();
  }
}
