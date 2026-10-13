// 아침·저녁·시험 알림 실행. notifications 행을 먼저 남기고(같은 날 두 번 금지, G5) 보낸다.
import type { Env } from './env.ts';
import { buildToday, loadSettings } from './deck.ts';
import { kstDay } from './time.ts';
import { eveningPayload, minutesFor, morningPayload, send, testPayload } from './discord.ts';
import type { Payload } from './discord.ts';

export type RunResult =
  | { skipped: string }
  | { ok: boolean; id: number; status: 'sent' | 'failed'; error?: string };

/** 행 넣기 → 보내기 → 결과 적기. UNIQUE(kind, day) 에 걸리면 dup. */
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
  const result = env.DISCORD_WEBHOOK
    ? await send(env.DISCORD_WEBHOOK, payload)
    : { ok: false, status: 0, error: 'no_webhook' };
  if (result.ok) {
    await env.DB.prepare('UPDATE notifications SET status = ?, sent_at = ?, discord_message_id = ? WHERE id = ?')
      .bind('sent', new Date().toISOString(), result.messageId ?? null, id)
      .run();
    return { ok: true, id, status: 'sent' };
  }
  const error = `${result.status} ${result.error ?? ''}`.trim();
  await env.DB.prepare('UPDATE notifications SET status = ?, error = ? WHERE id = ?').bind('failed', error, id).run();
  return { ok: false, id, status: 'failed', error };
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
