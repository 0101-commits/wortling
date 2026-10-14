// 웹 푸시: 기기 구독 목록(KV `_push`)과 발송. D1 에 두지 않는다 — 매일 D1 내보내기와 섞이지 않게(웹훅 `_webhook` 과 같은 규칙).
import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { Env } from './env.ts';

export const PUSH_KEY = '_push';
/** 기기 상한. 넘치면 오래된 것부터 뺀다 */
export const MAX_SUBS = 10;

export interface Sub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  added: string;
}
/** sw.js 가 받는 모양(type 이라야 라이브러리의 JSON 형에 맞는다) */
export type PushMsg = {
  title: string;
  body: string;
  image: string | null;
  url: string;
  tag: string;
  /** 알림 아래 누름 버튼(안드로이드·PC 크롬). later = 1시간 뒤 다시(A2) */
  actions?: Array<{ action: 'open' | 'later'; title: string }>;
  /** notifications.id 와 그 행의 action_key — 서비스 워커가 「1시간 뒤」를 보낼 때 쓴다(접속 키가 없어서) */
  nid?: number;
  key?: string;
};
export interface PushResult {
  ok: boolean;
  sent: number;
  failed: number;
  /** 404·410 이라 목록에서 지운 수 */
  gone: number;
  error?: string;
}

/** 목록이 깨져 있으면(손으로 고친 KV 등) 빈 목록 — 등록 주소가 500 으로 막히지 않게 */
export async function readSubs(env: Env): Promise<Sub[]> {
  try {
    const v = await env.IMG.get<unknown>(PUSH_KEY, 'json');
    return Array.isArray(v) ? (v as Sub[]) : [];
  } catch {
    return [];
  }
}
export async function writeSubs(env: Env, subs: Sub[]): Promise<void> {
  if (subs.length) await env.IMG.put(PUSH_KEY, JSON.stringify(subs));
  else await env.IMG.delete(PUSH_KEY);
}

/** summarize(payload) → 폰 알림. 본문 300자까지, 링크 없으면 오늘 카드, tag = 종류(같은 종류는 폰에서 하나로 겹침) */
export function pushMessage(
  s: { title: string; body: string; image: string | null; link: string | null },
  kind: string,
  appUrl: string,
  row?: { nid: number; key: string },
): PushMsg {
  const body = s.body.length > 300 ? s.body.slice(0, 299) + '…' : s.body;
  const msg: PushMsg = { title: s.title, body, image: s.image, url: s.link ?? `${appUrl}/#/today`, tag: kind };
  // 저녁 알림만 「1시간 뒤」(하루 한 번 — 미룬 알림 evening_later 에는 안 붙임)
  if (kind === 'evening' && row) Object.assign(msg, { actions: [{ action: 'open', title: '지금 하기' }, { action: 'later', title: '1시간 뒤' }], ...row });
  return msg;
}

/** 모든 기기로 보내기. 404·410 기기는 목록에서 지운다. 하나라도 가면 ok. */
export async function pushAll(env: Env, msg: PushMsg): Promise<PushResult> {
  const subs = await readSubs(env);
  if (!subs.length) return { ok: false, sent: 0, failed: 0, gone: 0, error: 'no_subscription' };
  if (!env.VAPID_PRIVATE_KEY) return { ok: false, sent: 0, failed: subs.length, gone: 0, error: 'no_vapid' };
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const errors: string[] = [];
  const gone = new Set<string>();
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        const p = await buildPushPayload(
          { data: msg, options: { ttl: 12 * 3600, urgency: 'high' } },
          { endpoint: s.endpoint, expirationTime: null, keys: s.keys },
          vapid,
        );
        const res = await fetch(s.endpoint, { ...p, signal: AbortSignal.timeout(10_000) }); // 멈춘 푸시 서비스가 기록을 붙잡지 않게
        if (res.ok) return void sent++;
        if (res.status === 404 || res.status === 410) gone.add(s.endpoint);
        errors.push(`${res.status} ${(await res.text()).slice(0, 200)}`.trim());
      } catch (e) {
        errors.push(String(e));
      }
    }),
  );
  // 보내는 사이 새로 붙은 기기를 지우지 않게 다시 읽고 거른다
  if (gone.size) await writeSubs(env, (await readSubs(env)).filter((s) => !gone.has(s.endpoint)));
  const failed = subs.length - sent;
  return { ok: sent > 0, sent, failed, gone: gone.size, ...(failed ? { error: errors.join('; ').slice(0, 300) } : {}) };
}
