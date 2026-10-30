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

/** 그림 확인 화면용 목록: 대기 그림 + 단어 정보(오래된 것 먼저 — 판정을 오래 못 받은 것이 맨 앞). 단어 행이 없는 대기분은 뺀다 */
export async function reviewPending(ctx: Ctx): Promise<Response> {
  const { items } = (await (await listPending(ctx)).json()) as { items: Array<{ id: string; at: string | null }> };
  const info = new Map<string, { lemma: string; gender: string | null; gloss_ko: string | null }>();
  // D1 은 한 질의에 묶음 값 100개까지 → 50개씩
  for (let i = 0; i < items.length; i += 50) {
    const ids = items.slice(i, i + 50).map((it) => it.id);
    const { results } = await ctx.env.DB.prepare(
      `SELECT id, lemma, gender, gloss_ko FROM words WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
      .bind(...ids)
      .all<{ id: string; lemma: string; gender: string | null; gloss_ko: string | null }>();
    for (const r of results) info.set(r.id, r);
  }
  const now = Date.now();
  const out = items.flatMap((it) => {
    const w = info.get(it.id);
    if (!w) return [];
    const days = it.at ? Math.max(0, Math.floor((now - Date.parse(it.at)) / 86_400_000)) : 0;
    return [{ id: it.id, at: it.at, days, lemma: w.lemma, gender: w.gender, gloss_ko: w.gloss_ko }];
  });
  return Response.json({ items: out });
}

/** 좋아요: 대기 그림을 그 단어의 공개 그림으로(매일 작업이 검사를 통과한 그림을 올릴 때와 같다 — PUT /api/admin/image) 올리고 대기에서 지운다 */
export async function approvePending({ env, params: [id] }: Ctx): Promise<Response> {
  const word = await env.DB.prepare('SELECT id FROM words WHERE id = ?').bind(id).first();
  const body = word && (await env.IMG.get(key(id), { type: 'arrayBuffer' }));
  if (!body) throw new HttpError(404, 'not_found'); // 단어가 없으면 대기분은 그대로 둔다(매일 작업이 치운다)
  const imageKey = `${id}.webp`;
  await env.IMG.put(imageKey, body);
  await env.DB.prepare("UPDATE words SET image_status = 'ok', image_id = ? WHERE id = ?").bind(imageKey, id).run();
  await env.IMG.delete(key(id));
  return Response.json({ ok: true, status: 'ok', image_id: imageKey });
}

/** 다시 그리기: 대기 그림을 버린다. 올라간 그림이 없는 단어는 'none' 으로 되돌려 매일 작업의 「그림 없는 단어」 목록에 다시 든다
 *  (검사 탈락 때 쓰는 'failed' 는 다시 그리지 않는 표시라 쓰지 않음). 이미 올라간 그림이 있으면(예전 그림체 다시 그리기) 그대로 둔다 */
export async function rejectPending({ env, params: [id] }: Ctx): Promise<Response> {
  const word = await env.DB.prepare('SELECT image_status FROM words WHERE id = ?').bind(id).first<{ image_status: string }>();
  if (!word) throw new HttpError(404, 'not_found');
  if (word.image_status !== 'ok') await env.DB.prepare("UPDATE words SET image_status = 'none' WHERE id = ?").bind(id).run();
  await env.IMG.delete(key(id));
  return Response.json({ ok: true, status: word.image_status === 'ok' ? 'ok' : 'none' });
}
