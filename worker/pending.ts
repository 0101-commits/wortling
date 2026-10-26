// 관리: 「검사 대기」 그림 보관. 그림 검사 AI(Gemini Flash)가 막힌 날 그린 그림을 버리지 않고 KV 에 맡겨 두었다가
// 다음 실행(scripts/daily.mjs)이 먼저 검사해 올린다 — 한 장 ≈109 뉴런을 헛쓰지 않으려고.
// 열쇠 `pending/<id>.webp` 는 공개 그림 길(/img/([\w-]+)\.webp → `${name}.webp`)로는 닿지 않는다(이름에 / 가 못 들어감).
// 토큰 확인은 index.ts 의 길 찾기가 한다(공개 표시 없는 길).
import type { Env } from './env.ts';
import { HttpError, bad } from './http.ts';

/** 그림 한 장 상한(webp 200KB) — index.ts 의 putImage 와 같은 값 */
export const MAX_IMAGE_BYTES = 200 * 1024;
const PREFIX = 'pending/';
const key = (id: string) => `${PREFIX}${id}.webp`;

interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: string[];
}
interface Meta {
  at: string;
  bytes: number;
}

/** 대기 그림 맡기기. 같은 단어를 또 맡기면 덮어쓴다 */
export async function putPending({ req, env, params: [id] }: Ctx): Promise<Response> {
  const word = await env.DB.prepare('SELECT id FROM words WHERE id = ?').bind(id).first();
  if (!word) throw new HttpError(404, 'not_found');
  if (!(req.headers.get('content-type') ?? '').startsWith('image/webp')) throw new HttpError(415, 'image/webp only');
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength === 0) throw bad('empty_body');
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'too_large');
  const meta: Meta = { at: new Date().toISOString(), bytes: bytes.byteLength };
  await env.IMG.put(key(id), bytes, { metadata: meta });
  return Response.json({ ok: true, id, ...meta });
}

/** 대기 목록(오래된 것 먼저). KV list 는 한 번에 1,000개라 끝까지 넘겨 읽는다 */
export async function listPending({ env }: Ctx): Promise<Response> {
  const items: Array<{ id: string; at: string | null; bytes: number | null }> = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.IMG.list<Meta>({ prefix: PREFIX, cursor });
    for (const k of page.keys) {
      items.push({ id: k.name.slice(PREFIX.length).replace(/\.webp$/, ''), at: k.metadata?.at ?? null, bytes: k.metadata?.bytes ?? null });
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  items.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.id.localeCompare(b.id));
  return Response.json({ items });
}

/** 대기 그림 받기(webp) */
export async function getPending({ env, params: [id] }: Ctx): Promise<Response> {
  const body = await env.IMG.get(key(id), { type: 'arrayBuffer' });
  if (!body) throw new HttpError(404, 'not_found');
  return new Response(body, { headers: { 'content-type': 'image/webp', 'cache-control': 'no-store' } });
}

/** 대기 그림 지우기. 없어도 성공(되풀이해도 안전) */
export async function deletePending({ env, params: [id] }: Ctx): Promise<Response> {
  await env.IMG.delete(key(id));
  return Response.json({ ok: true });
}
