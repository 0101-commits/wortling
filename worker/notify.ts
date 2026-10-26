// 아침·저녁·시험 알림 실행. notifications 행을 먼저 남기고(같은 날 두 번 금지, G5) 보낸다.
import type { Env } from './env.ts';
import type { DeckItem, Settings } from '../shared/api.ts';
import { clozeOf } from '../shared/cloze.ts';
import { eveningTitle, morningTitle, quiet, restOf, seedOf } from '../shared/copy.ts';
import type { Rest } from '../shared/copy.ts';
import { buildToday, loadSettings } from './deck.ts';
import { DAY_START_H, monthDay, studyDay } from './time.ts';
import { eveningPayload, hasStats, minutesFor, morningPayload, send, summarize, testPayload } from './discord.ts';
import type { Cloze, Payload } from './discord.ts';
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

/** 알림마다 만드는 무작위 열쇠(서비스 워커의 「1시간 뒤」용) */
const newKey = () => crypto.randomUUID().replace(/-/g, '');

/**
 * 행 넣기 → (알림 번호를 넣어) 글 만들기 → 디스코드·푸시를 서로 독립으로 보내기 → 결과 적기.
 * 하나라도 가면 sent. UNIQUE(kind, day) 에 걸리면 dup.
 */
async function dispatch(env: Env, kind: string, day: string, build: (n: number) => Payload, now: Date): Promise<RunResult> {
  let id: number;
  const key = newKey();
  try {
    const row = await env.DB.prepare(
      "INSERT INTO notifications(kind, day, scheduled_at, status, payload_json, action_key) VALUES (?, ?, ?, 'queued', '{}', ?) RETURNING id",
    )
      .bind(kind, day, now.toISOString(), key)
      .first<{ id: number }>();
    id = row!.id;
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return { skipped: 'dup' };
    throw e;
  }
  let payload: Payload;
  try {
    payload = build(id);
  } catch (e) {
    // 글을 못 만들면(금지어 등) 행을 실패로 남긴다 — 「대기」 로 남은 빈 행이 받은편지함을 막지 않게
    const error = `build: ${String(e).slice(0, 300)}`;
    await env.DB.prepare('UPDATE notifications SET status = ?, sent_at = ?, discord_message_id = ?, error = ?, payload_json = ? WHERE id = ?')
      .bind('failed', null, null, error, '{"flags":32768,"components":[]}', id)
      .run();
    return { ok: false, id, status: 'failed', error, discord: { ok: false, error: 'not_sent' }, push: { ok: false, sent: 0, failed: 0, gone: 0, error: 'not_sent' } };
  }
  const hook = await webhookUrl(env);
  const fail = (e: unknown): PushResult => ({ ok: false, sent: 0, failed: 0, gone: 0, error: String(e) });
  const [d, push] = await Promise.all([
    hook ? send(hook, payload) : null,
    // 푸시 글 만들기도 이 안에서 — 거기서 던져도 디스코드는 나간다
    Promise.resolve()
      .then(() => pushAll(env, pushMessage(summarize(payload), kind, env.APP_URL, { nid: id, key })))
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
  await env.DB.prepare(
    'UPDATE notifications SET status = ?, sent_at = ?, discord_message_id = ?, error = ?, payload_json = ? WHERE id = ?',
  )
    .bind(ok ? 'sent' : 'failed', ok ? new Date().toISOString() : null, d?.messageId ?? null, error ?? null, JSON.stringify(payload), id)
    .run();
  return { ok, id, status: ok ? 'sent' : 'failed', error, discord, push };
}

/** 움라우트·ß 를 풀어 소문자로(어간 비교용) */
const fold = (s: string) => s.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');

/**
 * 아침 빈칸 문제 고르기(A1): 덱 순서(복습 먼저)대로, 예문에 그 단어가 보이고 빈칸 뒤 정답이 새지 않는 첫 카드.
 * 거르는 것: 110자 넘는 예문 · 같은 낱말이 또 나옴 · 같은 어간(앞 5글자)이 남음(Bürgerin ↔ Bürger) · 뜻 힌트에 금지어(G6)
 */
export function pickCloze(items: DeckItem[]): Cloze | null {
  for (const { word } of items) {
    const de = word.example_de;
    if (!de || de.length > 110) continue;
    const line = clozeOf(de, word.lemma, word.example_hit);
    if (!line) continue;
    const base = fold(word.lemma.replace(/^sich\s+/i, ''));
    const rest = fold(line);
    if (rest.includes(base)) continue; // 같은 낱말이 두 번 나오면 정답이 새어 나감(G11)
    const stem = base.length >= 5 ? base.slice(0, 5) : null;
    if (stem && (rest.match(/[a-z]+/g) ?? []).some((t) => t.startsWith(stem))) continue;
    if (word.gloss_ko && hasStats(word.gloss_ko)) continue;
    return { id: word.id, line, hint: word.gloss_ko };
  }
  return null;
}

/** 채점한 학습일 최근 2개 → 쉰 날(A3). 휴가 기간은 세지 않는다 */
async function restNow(env: Env, day: string, settings: Settings): Promise<Rest> {
  const { results } = await env.DB.prepare(
    `SELECT strftime('%Y-%m-%d', reviewed_at, '+${9 - DAY_START_H} hours') AS d FROM reviews WHERE undone = 0 GROUP BY d ORDER BY d DESC LIMIT 2`,
  ).all<{ d: string }>();
  return restOf(results.map((r) => r.d), day, settings.vacation_until);
}

export async function runMorning(env: Env, now: Date = new Date()): Promise<RunResult> {
  const day = studyDay(now);
  const settings = await loadSettings(env.DB);
  if (settings.vacation_until && settings.vacation_until >= day) return { skipped: 'vacation' };
  const rest = await restNow(env, day, settings);
  if (quiet('morning', rest.rest, day)) return { skipped: 'quiet' };
  const today = await buildToday(env.DB, settings, now);
  const items = [...today.due, ...today.fresh];
  if (items.length === 0) return { skipped: 'empty' };
  const cloze = pickCloze(items);
  // 그림: 빈칸 단어의 그림이 있으면 그것(그림이 힌트), 없으면 덱에서 그림 있는 첫 장
  const withImage = items.find((i) => i.word.image && i.word.id === cloze?.id) ?? items.find((i) => i.word.image);
  const imageUrl = withImage ? `${env.APP_URL}/img/${withImage.word.id}.webp` : null;
  const title = morningTitle({ n: items.length, md: monthDay(day), ...rest, seed: seedOf(day) });
  return dispatch(env, 'morning', day, (n) => morningPayload({ day, items, total: items.length, appUrl: env.APP_URL, imageUrl, cloze, n, title }), now);
}

/** 저녁 알림 조건(A2). null = 보냄, 문자열 = 건너뛴 이유 */
export function eveningSkip(p: {
  remaining: number;
  reviewedToday: number;
  morningSent: boolean;
  mode: Settings['evening_mode'];
  min: number;
}): string | null {
  if (p.remaining < Math.max(1, p.min)) return 'none_due';
  if (p.mode === 'none_today' && p.reviewedToday > 0) return 'studied_today';
  if (!p.morningSent) return 'morning_not_sent';
  return null;
}

/**
 * kind = evening(21:00) · evening_later(「1시간 뒤」로 미룬 것, 보내기 직전에 조건을 다시 본다).
 * 남은 카드 = 오늘 몫(F4)에서 아직 안 한 것 — 오늘 학습일 안에 마감되는 복습 + 오늘 목록의 안 본 새 단어.
 * 오늘 몫을 다 했으면 남은 카드 0 → 알림 없음(예전엔 낮에 풀린 카드 때문에 거의 늘 갔다).
 */
export async function runEvening(env: Env, now: Date = new Date(), kind: 'evening' | 'evening_later' = 'evening'): Promise<RunResult> {
  const day = studyDay(now);
  const settings = await loadSettings(env.DB);
  if (settings.vacation_until && settings.vacation_until >= day) return { skipped: 'vacation' };
  const today = await buildToday(env.DB, settings, now);
  const morning = await env.DB.prepare("SELECT status FROM notifications WHERE kind = 'morning' AND day = ?").bind(day).first<{ status: string }>();
  const remaining = today.due.length + today.fresh.length;
  const reviewedToday = today.reviewed_today;
  const skip = eveningSkip({
    remaining,
    reviewedToday,
    morningSent: morning?.status === 'sent',
    mode: settings.evening_mode,
    min: settings.evening_min,
  });
  if (skip) return { skipped: skip };
  const rest = await restNow(env, day, settings);
  if (quiet('evening', rest.rest, day)) return { skipped: 'quiet' };
  const title = eveningTitle({ n: remaining, rest: rest.rest, studiedToday: reviewedToday > 0, seed: seedOf(day) });
  return dispatch(env, kind, day, (n) => eveningPayload({ remaining, minutes: minutesFor(remaining), appUrl: env.APP_URL, n, title }), now);
}

/** 「1시간 뒤」 를 받을 수 있는지: 그날(학습일) 저녁 통이고, 미룬 통이 아직 없고, 1시간 뒤가 23:30 KST 를 넘지 않을 때 */
export const LATER_MS = 3_600_000;
export const LATER_LAST_KST = '23:30';
export function laterAllowed(now: Date): boolean {
  const at = new Date(now.getTime() + LATER_MS);
  const kst = new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
  // 같은 학습일 안(04:00 넘어가면 다음 날)이고 23:30 이하
  return studyDay(at) === studyDay(now) && kst >= '04:00' && kst <= LATER_LAST_KST;
}

/** 연결 시험. day 에 전체 시각을 넣어 몇 번이고 보낼 수 있게 한다. */
export async function sendTest(env: Env, now: Date = new Date()): Promise<RunResult> {
  return dispatch(env, 'test', now.toISOString(), () => testPayload(), now);
}
