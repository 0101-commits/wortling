// DB 백엔드 스위치(2026-10-30: 계정 공용 D1 무료 읽기 한도를 worty 가 다 써 ai-cli 까지 멈춤 → worty DB 를 Supabase 로).
// 처리기는 D1 모양(env.DB.prepare(sql).bind(...).first()/all()/run(), batch)만 안다.
// DB_BACKEND=pg 이면 같은 모양의 어댑터를 Hyperdrive(worty-pg, 캐시 끔) 경유 Postgres(스키마 worty) 위에 얹어 env.DB 로 갈아 끼운다.
// 그 밖(d1·없음)은 env 를 건드리지 않는다 — 되돌리기 = wrangler.jsonc 의 DB_BACKEND 를 "d1" 로 두고 재배포.
// SQL 은 두 방언에서 같이 도는 부분집합으로 쓰고, 안 되는 곳만 아래 도우미(jsonEach · dayOf · ...)로 가른다. 바꾸는 것은 `?` → `$n` 하나뿐.
// 같은 방식: AI_CLI/worker/src/db.js. 스키마 scripts/db/schema.pg.sql, 이관 scripts/db/d1-to-pg.mjs.
import type { Env } from './env.ts';
import { bindOwner } from './memo.ts';

/** Postgres 어댑터인가(D1·시험용 node:sqlite 는 아님) */
export const isPg = (db: object): boolean => (db as { dialect?: string }).dialect === 'pg';

/** JSON 배열 문자열 자리표시자 하나를 value 칸 줄로 펼친다(FROM 절에 쓰는 표 + 별칭).
 *  pg 는 TEXT 로 받은 뒤 json 으로 — 자리표시자가 곧장 json 형이면 postgres.js 가 글자를 한 번 더 JSON.stringify 해 스칼라가 된다(10-30 실측) */
export const jsonEach = (db: object, alias: string) =>
  isPg(db) ? `json_array_elements_text(CAST(CAST(? AS TEXT) AS json)) ${alias}(value)` : `json_each(?) ${alias}`;

/** ISO 시각 칸에 h 시간을 더한 UTC 날짜 'YYYY-MM-DD' */
export const dayOf = (db: object, col: string, h: number) =>
  isPg(db)
    ? `to_char((CAST(${col} AS timestamptz) AT TIME ZONE 'UTC') + interval '${h} hours', 'YYYY-MM-DD')`
    : `strftime('%Y-%m-%d', ${col}, '+${h} hours')`;

/** 조인 순서를 못 박는 SQLite CROSS JOIN … ON. Postgres 는 CROSS JOIN 에 ON 을 못 붙여 보통 JOIN(순서는 계획기가 정한다) */
export const crossJoin = (db: object) => (isPg(db) ? 'JOIN' : 'CROSS JOIN');

/** 영문 대소문자 무시 부분 일치. SQLite LIKE 는 원래 ASCII 대소문자 무시 · Postgres ILIKE 는 칸이 COLLATE "C" 라 ASCII 만 */
export const ciLike = (db: object) => (isPg(db) ? 'ILIKE' : 'LIKE');

/** 칸 값을 쉼표로 이은 글(중복 없음) — SQLite group_concat(DISTINCT x) · Postgres string_agg(DISTINCT x, ',') */
export const concatDistinct = (db: object, col: string) => (isPg(db) ? `string_agg(DISTINCT ${col}, ',')` : `group_concat(DISTINCT ${col})`);

// 따옴표 안의 ? 는 건드리지 않고 자리표시자만 $1, $2 … 로 바꾼다
export function toPg(sql: string): string {
  let n = 0;
  let out = '';
  let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted; // '' 이스케이프는 두 번 뒤집혀 그대로 맞는다
    out += ch === '?' && !quoted ? `$${++n}` : ch;
  }
  return out;
}

/** 드라이버가 돌려준 줄들(postgres.js 결과: 배열 + 바뀐 줄 수 count) */
type Rows = Record<string, unknown>[] & { count?: number | null };
/** 질의 하나 실행. 거래(batch)는 begin 안에서 받은 exec 로 */
export interface PgConn {
  exec(text: string, params: unknown[]): Promise<Rows>;
  begin<T>(fn: (exec: PgConn['exec']) => Promise<T>): Promise<T>;
}

// D1 처럼: undefined → NULL, true/false → 1/0(정수 칸에 boolean 을 넣으면 Postgres 는 거절한다)
const arg = (v: unknown) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v);
// BIGINT 를 드라이버가 BigInt 로 줄 때를 대비해 숫자로(Worker 는 수를 비교하고 JSON 으로 내보낸다)
const plain = (row: Record<string, unknown>) => {
  const o: Record<string, unknown> = { ...row };
  for (const k of Object.keys(o)) if (typeof o[k] === 'bigint') o[k] = Number(o[k]);
  return o;
};

/** pg 연결 위의 D1 모양. 어댑터는 요청마다 새로 만들지만 memo(아이솔레이트 기억)는 owner 하나로 묶는다 */
export function createPgDb(conn: PgConn, owner: object = PG_OWNER): D1Database {
  class Stmt {
    sql: string;
    params: unknown[];
    constructor(sql: string, params: unknown[] = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...p: unknown[]) {
      return new Stmt(this.sql, p.map(arg));
    }
    async exec(run: PgConn['exec'] = conn.exec) {
      const rows = await run(toPg(this.sql), this.params);
      return { results: rows.map(plain), success: true, meta: { changes: Number(rows.count ?? 0), rows_read: 0 } };
    }
    all() {
      return this.exec();
    }
    async first(col?: string) {
      const row = (await this.exec()).results[0];
      if (row === undefined) return null;
      return col ? row[col] : row;
    }
    run() {
      return this.exec();
    }
  }
  const db = {
    dialect: 'pg',
    prepare: (sql: string) => new Stmt(sql),
    // D1 batch 는 한 거래 — 하나라도 실패하면 전부 되돌린다
    batch: (stmts: Stmt[]) =>
      conn.begin(async (exec) => {
        const out = [];
        for (const s of stmts) out.push(await s.exec(exec));
        return out;
      }),
  };
  bindOwner(db, owner);
  return db as unknown as D1Database;
}

/** 이 아이솔레이트의 pg DB 기억 열쇠(memo.ts) — 요청마다 어댑터가 새로 생겨도 세기 기억이 이어지게 */
const PG_OWNER = {};

/** Hyperdrive 연결 문자열로 postgres.js 를 연다. 요청마다 새로 만들고 끝나면 닫는다(Cloudflare 안내). 연결은 첫 질의 때 맺는다 */
async function hyperdriveConn(env: Env): Promise<{ conn: PgConn; close: () => Promise<void> }> {
  const { default: postgres } = await import('postgres');
  const sql = postgres(env.HYPERDRIVE!.connectionString, {
    max: 5,
    fetch_types: false,
    // BIGINT(20)·NUMERIC(1700, sum(bigint) 결과) → 숫자. 그대로 두면 글자로 온다
    types: {
      int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
    },
  });
  const exec = (text: string, params: unknown[]) => sql.unsafe(text, params as never[]) as unknown as Promise<Rows>;
  return {
    conn: {
      exec,
      begin: (fn) => sql.begin((tx) => fn((text, params) => tx.unsafe(text, params as never[]) as unknown as Promise<Rows>)) as Promise<never>,
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

type WaitCtx = { waitUntil(p: Promise<unknown>): void };

/**
 * 요청·알람 한 번을 감싼다. call(env, ctx) 의 env.DB 가 백엔드에 맞게 바뀐다.
 * ctx.waitUntil 로 매단 DB 작업(읽기 기록 등)이 끝난 다음에야 연결을 닫는다 — 응답이 나가자마자 닫으면 뒷일이 끊긴다.
 */
export async function withDb<T>(env: Env, ctx: WaitCtx, call: (env: Env, ctx: WaitCtx) => Promise<T>): Promise<T> {
  if (env.DB_BACKEND !== 'pg') return call(env, ctx);
  if (!env.HYPERDRIVE) throw new Error('DB_BACKEND=pg 인데 HYPERDRIVE 바인딩이 없다 — wrangler.jsonc hyperdrive 확인');
  const { conn, close } = await hyperdriveConn(env);
  const pending: Promise<unknown>[] = [];
  const ctx2: WaitCtx = {
    waitUntil: (p) => {
      pending.push(p);
      ctx.waitUntil(p);
    },
  };
  try {
    return await call({ ...env, DB: createPgDb(conn) }, ctx2);
  } finally {
    ctx.waitUntil(
      (async () => {
        for (let n = -1; n !== pending.length; ) {
          n = pending.length;
          await Promise.allSettled(pending.slice());
        }
        await close();
      })(),
    );
  }
}
