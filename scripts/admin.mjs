// Worker 관리 API · 디스코드 알림 · 날짜 — words.yml 의 news.mjs · review.mjs 가 같이 쓴다.
// (daily.mjs · update.mjs 는 예전 사본을 그대로 쓴다.) .env 가 있으면 읽고, Actions 에서는 비밀값 환경변수.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || '';

export function requireEnv() {
  if (!APP_URL || !TOKEN) throw new Error('APP_URL · API_TOKEN 이 없다(.env 또는 Actions 비밀값)');
}

/** 관리 API. AI 를 기다리는 사이 묵은 연결이 끊기면 한 번 다시 */
export async function api(p, { method = 'GET', body } = {}) {
  const init = {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  };
  let res;
  try {
    res = await fetch(APP_URL + p, init);
  } catch (e) {
    console.error(`재시도 ${method} ${p}: ${e.cause?.code || e.message}`);
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(APP_URL + p, init);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** 디스코드 알림. PC 면 AI_CLI 알리미, 깃허브 서버면 DISCORD_WEBHOOK_URL 로 바로. 보냈으면 true */
export async function notify(type, title, desc) {
  const notifier = 'C:/Users/cgpar/AI_CLI/scripts/discord-notify.js';
  if (existsSync(notifier)) {
    const r = spawnSync(process.execPath, [notifier, 'send'], { input: JSON.stringify({ type, title, desc, cli: 'claude' }), encoding: 'utf8', windowsHide: true, timeout: 20000 });
    return r.status === 0;
  }
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: `**${title}**\n${desc}`.slice(0, 1900) }) });
    return res.ok;
  } catch {
    return false;
  }
}

export const kstDay = (d = new Date()) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/** GitHub Actions 단계 출력(steps.<id>.outputs.<name>). Actions 밖이면 아무것도 안 함 */
export function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
