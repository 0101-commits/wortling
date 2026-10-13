// 아침·저녁·시험 알림 실행. notifications 행을 먼저 남기고(같은 날 두 번 금지, G5) 보낸다.
import type { Env } from './env.ts';
import { buildToday, loadSettings } from './deck.ts';
import { kstDay } from './time.ts';
import { eveningPayload, minutesFor, morningPayload, send, summarize, testPayload } from './discord.ts';
import type { Payload } from './discord.ts';
import { pushAll, pushMessage } from './push.ts';
import type { PushResult } from './push.ts';

/** 웹훅 주소: Worker 비밀값이 있으면 그것, 없으면 설정 화면에서 넣은 값(KV `_webhook`, D1 백업에 안 섞이게 KV 에 둠) */
export const WEBHOOK_KEY = '_webhook';
export const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
export async function webhookUrl(env: Env): Promise<string | null> {
  return env.DISCORD_WEBHOOK || (await env.IMG.get(WEBHOOK_KEY));
}

export type RunResult =
  | { skipped: string }
  | {
      ok: boolean;
      id: number;
      status: 'sent' | 'failed';
      error?: string;
      /** 채널별 결과(시험 통 토스트·웹훅 저장이 씀). discord.error 는 종전 꼴 `상태코드 사유` */
      discord: { ok: boolean; error?: string };
      push: PushResult;
    };

/** 행 넣기 → 디스코드·푸시를 서로 독립으로 보내기 → 결과 적기. 하나라도 가면 sent. UNIQUE(kind, day) 에 걸리면 dup. */
async function dispatch(env: Env, kind: string, day: string, payload: Payload, now: Date): Promise<RunResult> {
  let id: number;
  try {
    const row = await env.DB.prepare(
      "INSERT INTO notifications(kind, day, scheduled_at, status, payload_json) VALUES (?, ?, ?, 'queued', ?) RETURNING id",
    )
      .bind(kind, day, now.toISOString(), JSON.stringify(payload))
      .first<{ id: number }>();
    id = row!.id;
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return { skipped: 'dup' };
    throw e;
  }
  const hook = await webhookUrl(env);
  const fail = (e: unknown): PushResult => ({ ok: false, sent: 0, failed: 0, gone: 0, error: String(e) });
  const [d, push] = await Promise.all([
    hook ? send(hook, payload) : null,
    // 푸시 글 만들기도 이 안에서 — 거기서 던져도 디스코드는 나간다
    Promise.resolve()
      .then(() => pushAll(env, pushMessage(summarize(payload), kind, env.APP_URL)))
      .catch(fail),
  ]);
  const discord = d?.ok ? { ok: true } : { ok: false, error: d ? `${d.status} ${d.error ?? ''}`.trim() : 'no_webhook' };
  const ok = discord.ok || push.ok;
  // 안 붙인 채널(웹훅 없음 · 기기 없음)은 실패 사유로 적지 않는다 — 매일 행마다 같은 잡음이 쌓인다
  const unset = (e?: string) => e === 'no_webhook' || e === 'no_subscription';
  const error =
    !hook && push.error === 'no_subscription'
      ? 'no_channel'
      : [!discord.ok && !unset(discord.error) && `discord: ${discord.error}`, !push.ok && !unset(push.error) && `push: ${push.error}`]
          .filter(Boolean)
          .join('; ') || undefined;
  await env.DB.prepare('UPDATE notifications SET status = ?, sent_at = ?, discord_message_id = ?, error = ? WHERE id = ?')
    .bind(ok ? 'sent' : 'failed', ok ? new Date().toISOString() : null, d?.messageId ?? null, error ?? null, id)
    .run();
  return { ok, id, status: ok ? 'sent' : 'failed', error, discord, push };
}

export async function runMorning(env: Env, now: Date = new Date()): Promise<RunResult> {
  const day = kstDay(now);
  const settings = await loadSettings(env.DB);
  if (settings.vacation_until && settings.vacation_until >= day) return { skipped: 'vacation' };
  const today = await buildToday(env.DB, settings, now);
  const items = [...today.due, ...today.fresh];
  if (items.length === 0) return { skipped: 'empty' };
  const withImage = items.find((i) => i.word.image);
  const imageUrl = withImage ? `${env.APP_URL}/img/${withImage.word.id}.webp` : null;
  const payload = morningPayload({ day, items, total: items.length, appUrl: env.APP_URL, imageUrl });
  return dispatch(env, 'morning', day, payload, now);
}

export async function runEvening(env: Env, now: Date = new Date()): Promise<RunResult> {
  const day = kstDay(now);
  const settings = await loadSettings(env.DB);
  if (settings.vacation_until && settings.vacation_until >= day) return { skipped: 'vacation' };
  const [rem, morning] = await env.DB.batch([
    env.DB.prepare('SELECT count(*) AS n FROM cards WHERE state IN (1, 2, 3) AND suspended = 0 AND due <= ?').bind(
      now.toISOString(),
    ),
    env.DB.prepare("SELECT status FROM notifications WHERE kind = 'morning' AND day = ?").bind(day),
  ]);
  const remaining = (rem.results[0] as { n: number }).n;
  if (remaining < 1) return { skipped: 'none_due' };
  if ((morning.results[0] as { status: string } | undefined)?.status !== 'sent') return { skipped: 'morning_not_sent' };
  const payload = eveningPayload({ remaining, minutes: minutesFor(remaining), appUrl: env.APP_URL });
  return dispatch(env, 'evening', day, payload, now);
}

/** 연결 시험. day 에 전체 시각을 넣어 몇 번이고 보낼 수 있게 한다. */
export async function sendTest(env: Env, now: Date = new Date()): Promise<RunResult> {
  return dispatch(env, 'test', now.toISOString(), testPayload(), now);
}
