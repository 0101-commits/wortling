// D1 하루 읽기 지킴이(2026-10-30: 무료 5M 소진 → 503 db_quota). 요청마다 meta.rows_read 를 더해 UTC 하루 합계표(read_budget)에 적는다.
//  - 합계가 ALERT_AT 을 넘는 순간 디스코드 한 번 알림, BLOCK_AT 위로는 관리·일괄 길이 429 read_budget(학습 길은 계속)
//  - 0010 이 아직 안 적용돼 표가 없으면 지킴이를 끈다(1분 뒤 다시 확인) — 배포 순서가 앱을 죽이지 않게
import type { Env } from './env.ts';
import { send } from './discord.ts';
import type { Payload } from './discord.ts';
import { bindOwner } from './memo.ts';
import { webhookUrl } from './notify.ts';

export const ALERT_AT = 2_500_000;
export const BLOCK_AT = 4_000_000;
const RETRY_MS = 60_000;

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** D1 를 감싸 읽은 행 수를 acc.rows 에 더한다. first() 는 meta 가 없어 all() 로 돌려 센다 */
export function meterDb(db: D1Database, acc: { rows: number }): D1Database {
  const add = <T extends { meta?: { rows_read?: number } }>(r: T): T => {
    acc.rows += Number(r?.meta?.rows_read ?? 0);
    return r;
  };
  const wrap = (st: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(st, {
      get(t, p) {
        if (p === 'bind') return (...a: unknown[]) => wrap(t.bind(...a));
        if (p === 'all') return async () => add(await t.all());
        if (p === 'run') return async () => add(await t.run());
        if (p === 'first')
          return async (col?: string) => {
            const r = add(await t.all());
            const row = r.results[0] as Record<string, unknown> | undefined;
            return row === undefined ? null : col ? row[col] : row;
          };
        const v = Reflect.get(t, p, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  const metered = new Proxy(db, {
    get(t, p) {
      if (p === 'prepare') return (sql: string) => wrap(t.prepare(sql));
      if (p === 'batch') return async (stmts: D1PreparedStatement[]) => (await t.batch(stmts)).map(add);
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  bindOwner(metered, db);
  return metered;
}

interface State {
  off: number; // 표 없음으로 끈 시각(0 = 켜짐)
  day: string;
  total: number | null; // 이 아이솔레이트가 아는 오늘 합계
  at: number; // total 을 읽은 시각
}
const states = new WeakMap<object, State>();
const st = (db: object): State => {
  let s = states.get(db);
  if (!s) states.set(db, (s = { off: 0, day: '', total: null, at: 0 }));
  return s;
};
const missing = (e: unknown) => /no such table/i.test(String(e));

/** 요청 하나가 읽은 rows 를 오늘 합계에 더한다(ctx.waitUntil 로 부른다). 0 이면 쓰기 없음 */
export async function recordReads(env: Env, rows: number, now = new Date()): Promise<void> {
  if (rows <= 0) return;
  const s = st(env.DB);
  if (s.off && now.getTime() - s.off < RETRY_MS) return;
  try {
    const day = utcDay(now);
    const r = await env.DB.prepare(
      'INSERT INTO read_budget(day, n) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET n = n + excluded.n RETURNING n',
    )
      .bind(day, rows)
      .first<{ n: number }>();
    s.off = 0;
    const n = Number(r?.n ?? 0);
    s.day = day;
    s.total = n;
    s.at = now.getTime();
    // 이번 요청이 선을 넘긴 한 번만(겹친 요청은 서로 다른 n 구간을 받는다)
    if (n - rows < ALERT_AT && n >= ALERT_AT) {
      const hook = await webhookUrl(env).catch(() => null);
      if (hook) await send(hook, { flags: 32768, components: [{ type: 10, content: `D1 읽기 오늘 50% 넘음 (${n.toLocaleString('en-US')} / 5,000,000행 · UTC ${day})` }] } as Payload).catch(() => undefined);
    }
  } catch (e) {
    if (missing(e)) s.off = now.getTime();
    else console.error('read_budget', e);
  }
}

/** 오늘 합계(표 없음·오류면 null → 막지 않음). 아이솔레이트 안 1분 기억, 읽기 1행 */
export async function todayTotal(env: Env, now = new Date()): Promise<number | null> {
  const s = st(env.DB);
  const day = utcDay(now);
  if (s.off && now.getTime() - s.off < RETRY_MS) return null;
  if (s.day === day && s.total !== null && now.getTime() - s.at < RETRY_MS) return s.total;
  try {
    const r = await env.DB.prepare('SELECT n FROM read_budget WHERE day = ?').bind(day).first<{ n: number }>();
    s.off = 0;
    s.day = day;
    s.total = Number(r?.n ?? 0);
    s.at = now.getTime();
    return s.total;
  } catch (e) {
    if (missing(e)) s.off = now.getTime();
    return null;
  }
}

/** 관리·일괄 길(스크립트용)을 막을 때인가 */
export async function overBudget(env: Env, now = new Date()): Promise<boolean> {
  return ((await todayTotal(env, now)) ?? 0) >= BLOCK_AT;
}

/** 막는 길: 관리 길 전부(스크립트·일괄용). 학습 길(today·reviews·word 상세)은 안 막는다 */
export const isBulkPath = (pathname: string) => pathname.startsWith('/api/admin/');
