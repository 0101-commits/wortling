// Worker 바인딩·비밀값 모양(wrangler.jsonc 와 짝). 비밀값은 `wrangler secret put` 또는 .dev.vars 로.
export interface Env {
  /** D1(되돌리기 길) 또는 DB_BACKEND=pg 일 때 worker/db.ts 가 끼우는 Postgres 어댑터(같은 모양) */
  DB: D1Database;
  /** d1 | pg (wrangler.jsonc vars). pg = Hyperdrive 경유 Supabase Postgres(스키마 worty) */
  DB_BACKEND?: string;
  HYPERDRIVE?: Hyperdrive;
  /** 그림 저장(Workers KV, 키 = w0001.webp). R2 는 계정에서 꺼져 있어 KV 로 둠 — 무료 1GB · 쓰기 1,000/일 */
  IMG: KVNamespace;
  /** 알림 시계(Durable Object 알람, worker/alarm.ts) */
  SCHED: DurableObjectNamespace<import('./alarm.ts').Scheduler>;
  /** 그림 생성(Workers AI, 무료 하루 10,000 뉴런). 모델 이름이 타입 목록에 없을 수 있어 좁게 둠 */
  AI: { run(model: string, input: unknown): Promise<unknown> };
  APP_URL: string;
  API_TOKEN: string;
  DISCORD_WEBHOOK?: string;
  /** 웹 푸시(worker/push.ts): 공개 열쇠·주체는 vars, 비밀 열쇠는 비밀값. 비밀 열쇠가 없으면 푸시는 건너뜀(no_vapid) */
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  VAPID_PRIVATE_KEY?: string;
}
