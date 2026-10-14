// 웹 푸시: 알림 내용 모양 + dispatch 의 두 채널 독립(가짜 fetch · D1 · KV)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { pushMessage, PUSH_KEY } from '../worker/push.ts';
import { sendTest } from '../worker/notify.ts';

test('pushMessage: 모양 · 본문 300자 자르기 · 링크 없으면 오늘 카드', () => {
  const m = pushMessage({ title: '오늘 카드 3', body: '본문', image: 'https://a/img/w1.webp', link: 'https://a/#/today' }, 'morning', 'https://a');
  assert.deepEqual(m, { title: '오늘 카드 3', body: '본문', image: 'https://a/img/w1.webp', url: 'https://a/#/today', tag: 'morning' });
  const long = pushMessage({ title: 't', body: '가'.repeat(400), image: null, link: null }, 'evening', 'https://a');
  assert.equal(long.body.length, 300);
  assert.ok(long.body.endsWith('…'));
  assert.equal(long.url, 'https://a/#/today');
  assert.equal(long.tag, 'evening');
  assert.equal(pushMessage({ title: 't', body: '나'.repeat(300), image: null, link: null }, 'test', 'https://a').body.length, 300);
});

// ---------- 가짜 바인딩 ----------
const kv = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    m,
    async get(k, type) {
      const v = m.get(k) ?? null;
      return v !== null && type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
  };
};
const db = () => {
  const updates = [];
  return {
    updates,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => ({ id: 7 }),
            run: async () => (sql.startsWith('UPDATE') && updates.push(args), {}),
          };
        },
      };
    },
  };
};
const vapid = async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { VAPID_PUBLIC_KEY: Buffer.from(raw).toString('base64url'), VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', kp.privateKey)).d };
};
const sub = (endpoint) => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  return { endpoint, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }, added: '2026-10-13T00:00:00Z' };
};
const HOOK = 'https://discord.com/api/webhooks/1/abc';

/** fetch 를 갈아 끼우고(디스코드 재시도 5초도 0초로) 시험 통 한 번 */
async function run(env, statusOf) {
  const realFetch = globalThis.fetch;
  const realTimeout = globalThis.setTimeout;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push(u);
    const s = statusOf(u);
    return new Response(s === 200 ? JSON.stringify({ id: 'm1' }) : `err ${s}`, { status: s });
  };
  globalThis.setTimeout = (fn) => realTimeout(fn, 0);
  try {
    return { r: await sendTest(env, new Date('2026-10-13T00:00:00Z')), calls };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realTimeout;
  }
}
const baseEnv = async (over) => ({ APP_URL: 'https://w.example', VAPID_SUBJECT: 'mailto:a@b.c', ...(await vapid()), DB: db(), ...over });

test('dispatch: 디스코드 실패 + 푸시 성공 → sent, 410 기기는 목록에서 빠진다', async () => {
  const a = sub('https://push.example/a');
  const b = sub('https://push.example/b');
  const env = await baseEnv({ DISCORD_WEBHOOK: HOOK, IMG: kv({ [PUSH_KEY]: JSON.stringify([a, b]) }) });
  const { r } = await run(env, (u) => (u.includes('discord.com') ? 500 : u.endsWith('/a') ? 201 : 410));
  assert.equal(r.status, 'sent');
  assert.equal(r.ok, true);
  assert.equal(r.discord.ok, false);
  assert.match(r.discord.error, /^500 /);
  assert.deepEqual({ sent: r.push.sent, failed: r.push.failed, gone: r.push.gone }, { sent: 1, failed: 1, gone: 1 });
  assert.match(r.error, /^discord: 500/);
  assert.doesNotMatch(r.error, /push:/);
  assert.deepEqual(JSON.parse(env.IMG.m.get(PUSH_KEY)).map((s) => s.endpoint), ['https://push.example/a']);
  const [status, sentAt, , error, , id] = env.DB.updates[0];
  assert.equal(status, 'sent');
  assert.ok(sentAt);
  assert.equal(error, r.error);
  assert.equal(id, 7);
});

test('dispatch: 둘 다 실패 → failed, 두 사유를 다 적는다', async () => {
  const a = sub('https://push.example/a');
  const env = await baseEnv({ DISCORD_WEBHOOK: HOOK, IMG: kv({ [PUSH_KEY]: JSON.stringify([a]) }) });
  const { r, calls } = await run(env, (u) => (u.includes('discord.com') ? 500 : 503));
  assert.equal(r.status, 'failed');
  assert.equal(r.ok, false);
  assert.match(r.error, /discord: 500 .*; push: 503/);
  assert.equal(calls.filter((u) => u.includes('discord.com')).length, 2, '디스코드는 한 번 더 시도');
  assert.equal(JSON.parse(env.IMG.m.get(PUSH_KEY)).length, 1, '503 은 지우지 않는다');
  assert.equal(env.DB.updates[0][0], 'failed');
  assert.equal(env.DB.updates[0][1], null);
});

test('dispatch: 디스코드 성공 + 비밀 열쇠 없음 → sent, push: no_vapid', async () => {
  const env = await baseEnv({ DISCORD_WEBHOOK: HOOK, VAPID_PRIVATE_KEY: undefined, IMG: kv({ [PUSH_KEY]: JSON.stringify([sub('https://push.example/a')]) }) });
  const { r, calls } = await run(env, () => 200);
  assert.equal(r.status, 'sent');
  assert.equal(r.push.error, 'no_vapid');
  assert.equal(r.error, 'push: no_vapid');
  assert.equal(env.DB.updates[0][2], 'm1', '디스코드 메시지 번호');
  assert.equal(calls.length, 1, '푸시 쪽은 보내지 않음');
});

test('dispatch: 웹훅·구독 둘 다 없으면 no_channel', async () => {
  const env = await baseEnv({ IMG: kv() });
  const { r, calls } = await run(env, () => 200);
  assert.equal(r.status, 'failed');
  assert.equal(r.error, 'no_channel');
  assert.equal(calls.length, 0);
});

test('dispatch: 디스코드만 붙음(기기 없음) → sent, 잡음 사유 없음', async () => {
  const env = await baseEnv({ DISCORD_WEBHOOK: HOOK, IMG: kv() });
  const { r } = await run(env, () => 200);
  assert.equal(r.status, 'sent');
  assert.equal(r.push.error, 'no_subscription');
  assert.equal(r.error, undefined, '안 붙인 채널은 실패 사유가 아니다');
  assert.equal(env.DB.updates[0][3], null);
});

test('dispatch: 깨진 구독 목록(KV)이어도 디스코드는 나간다', async () => {
  const env = await baseEnv({ DISCORD_WEBHOOK: HOOK, IMG: kv({ [PUSH_KEY]: '{"not":"array"}' }) });
  const { r } = await run(env, () => 200);
  assert.equal(r.status, 'sent');
  assert.equal(r.discord.ok, true);
  assert.equal(r.push.error, 'no_subscription');
});
