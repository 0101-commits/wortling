// Worker 바인딩·비밀값 모양(wrangler.jsonc 와 짝). 비밀값은 `wrangler secret put` 또는 .dev.vars 로.
export interface Env {
  DB: D1Database;
  /** 그림 저장(Workers KV, 키 = w0001.webp). R2 는 계정에서 꺼져 있어 KV 로 둠 — 무료 1GB · 쓰기 1,000/일 */
  IMG: KVNamespace;
  /** 알림 시계(Durable Object 알람, worker/alarm.ts) */
  SCHED: DurableObjectNamespace<import('./alarm.ts').Scheduler>;
  APP_URL: string;
  API_TOKEN: string;
  DISCORD_WEBHOOK?: string;
}
