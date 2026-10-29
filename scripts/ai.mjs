// Gemini 한 번 불러 JSON 배열을 받는다. 매일 작업(글·장면 쓰기 · 카드 검토 · 뉴스 단어)과 그림 뜻 검사(judge.mjs)가 같이 쓴다.
// 2026-10-19 사용자 「claude 말고 다른 AI 로」 — 예전 claude -p 는 구독 토큰(CLAUDE_CODE_OAUTH_TOKEN)이라 클로드 코드 한도를 같이 깎았다.
// 이제 Gemini 무료 몫(GEMINI_API_KEY). 키는 헤더로(URL 에 넣으면 오류 문구에 찍힌다).
// Google 이 모델을 조용히 퇴역시킨다(economic-site 2026-09-15 실측 404) → 별칭(-latest)을 쓴다.
// 2026-10-19 실측: Flash 무료 몫은 하루 약 20번(15번쯤 쓰고 429)이라 매일 작업(≈25번)에 모자람 → 역할을 나눈다(사용자 결정).
//   글·장면·카드 검토·뉴스 단어 = Flash-Lite(하루 약 500번) · 그림 검사(judge.mjs) = Flash 만.
//   Lite 를 그림 검사 대신 쓰지 않는다 — 같은 날 25장을 하나도 안 떨어뜨렸고 #3 판정을 #4 에 붙이는 등 번호도 섞었다.
export const TEXT_MODELS = ['gemini-flash-lite-latest'];
// 기본 모델 하나만. 예비로 두었던 gemini-2.5-flash 는 퇴역해 404 「no longer available to new users」(2026-10-25 실측)라 뺐다.
// 다른 예비 모델도 두지 않기로 했다(2026-10-26) — 503 「high demand」로 막히면 그린 그림을 검사 대기로 맡겨 다음 날 검사한다(scripts/pending.mjs)
export const VISION_MODELS = ['gemini-flash-latest'];
// 다시 묻기 전 기다림(429 분당 한도는 1분). 시험은 AI_RETRY_MS=0
const WAIT_MS = process.env.AI_RETRY_MS ? Number(process.env.AI_RETRY_MS) : 15_000;

const total = { calls: 0, input: 0, output: 0, thinking: 0 };
process.on('exit', () => {
  if (total.calls) console.error(`AI 합계: ${total.calls}번 · 입력 ${total.input} · 출력 ${total.output} · 생각 ${total.thinking}`);
});

/** 텍스트에서 JSON 배열을 꺼낸다 — 그대로 · 코드 울타리 안 [ … ] · { … } · {"items":[…]} 감쌈 · 단일 객체 순으로 */
export function parseJsonArray(text) {
  let v;
  for (const s of [text, text.slice(text.indexOf('['), text.lastIndexOf(']') + 1), text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    try { v = JSON.parse(s); break; } catch { /* 다음 */ }
  }
  // 항목이 하나면 [{…}] 대신 {…} 로, 가끔 {"items": […]} 처럼 감싸 온다. 항목(id·n·key)처럼 생긴 것만 감싸고
  // {"error": …} 같은 것은 실패로 둔다(감싸면 부르는 쪽이 맞는 항목 0개를 조용히 성공으로 받는다)
  if (v && typeof v === 'object' && !Array.isArray(v)) v = 'id' in v || 'n' in v || 'key' in v ? [v] : Object.values(v).find(Array.isArray);
  return Array.isArray(v) ? v : null;
}

async function once(model, body, key) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  const j = await res.json().catch(() => ({}));
  // 하루 몫 소진(429 …PerDay…)은 1분 기다려도 그대로 → 곧장 다음 모델(final). 어느 한도인지 로그에 남게 quotaId 를 앞에
  if (!res.ok) {
    const details = JSON.stringify(j.error?.details ?? '');
    const quota = details.match(/"quotaId":"([^"]+)"/)?.[1];
    throw Object.assign(new Error(`${res.status}${quota ? ` [${quota}]` : ''} ${String(j.error?.message || '').slice(0, 200)}`), { status: res.status, final: /PerDay/i.test(details) });
  }
  const u = j.usageMetadata || {};
  const n = { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0, thinking: u.thoughtsTokenCount || 0 };
  total.calls++;
  for (const k of Object.keys(n)) total[k] += n[k];
  // 별칭(-latest)이 실제로 어느 판인지 남긴다
  console.error(`AI 사용량(${model}${j.modelVersion && j.modelVersion !== model ? ` = ${j.modelVersion}` : ''}): 입력 ${n.input} · 출력 ${n.output} · 생각 ${n.thinking}`);
  const c = j.candidates?.[0];
  const text = (c?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  // 잘린 응답의 앞부분만 받으면 나머지 항목이 조용히 빠진다 → 다시 묻는다
  if (c?.finishReason === 'MAX_TOKENS') throw new Error(`응답이 잘림(MAX_TOKENS): ${text.slice(-120)}`);
  // 그대로 → 앞뒤 말·코드 울타리를 떼고 [ … ] → { … } 차례로 읽어 본다
  const v = parseJsonArray(text);
  if (v) return v;
  // 막힌 응답은 다시 물어도 같다 → final
  const blocked = Boolean(j.promptFeedback?.blockReason) || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(c?.finishReason);
  throw Object.assign(new Error(`결과가 JSON 배열이 아님(${c?.finishReason || j.promptFeedback?.blockReason || '?'}): ${text.slice(0, 200)}`), { final: blocked });
}

/** prompt → JSON 배열. images = [{label, png}](judge.mjs) — 글 뒤에 「label」 글 조각 + PNG 버퍼를 차례로 붙인다.
 *  models 차례로, 모델마다 세 번까지: 429·503(혼잡) 은 1분, 그 밖 5xx·끊김·깨진 JSON 은 15초 뒤 다시.
 *  404·그 밖 4xx·하루 몫 소진·막힘은 곧장 다음 모델. 다 실패면 던진다 */
export async function askJson(prompt, { images = [], models = TEXT_MODELS } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 가 없다(.env 또는 Actions 비밀값)');
  const parts = [{ text: prompt }];
  for (const im of images) {
    if (im.label) parts.push({ text: im.label });
    parts.push({ inline_data: { mime_type: 'image/png', data: im.png.toString('base64') } });
  }
  const body = { contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json' } };
  let err;
  for (const model of models) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(model, body, key);
      } catch (e) {
        err = e;
        console.error(`AI 실패(${model} ${attempt}회): ${String(e.message).slice(0, 200)}`);
        if (e.final || attempt >= 3 || (e.status >= 400 && e.status < 500 && e.status !== 429)) break;
        // 429(분당 한도)·503(혼잡)은 15초로는 안 풀린다(10-20 503 세 번 연속) → 1분
        await new Promise((r) => setTimeout(r, (e.status === 429 || e.status === 503) && WAIT_MS ? 60_000 : WAIT_MS));
      }
    }
  }
  throw err;
}

// Groq 폴백(2026-10-29) — Gemini Flash(vision) 가 503/timeout 으로 이틀째 맛 감. 그림 뜻 검사(judge.mjs) 전용.
// qwen/qwen3.8-27b (Groq 공식 vision 모델, 무료·카드 불필요). OpenAI 호환 엔드포인트.
// 이미지는 한 번에 3장까지 → judge.mjs 에서 끊는다. 모델은 GROQ_MODEL 환경값으로 바꿀 수 있다.
const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
const GROQ_WAIT_MS = process.env.AI_RETRY_MS ? Number(process.env.AI_RETRY_MS) : 15_000;
/** prompt → JSON 배열. images = [{label, png}]. 모델마다 세 번까지: 429 는 1분, 그 밖 5xx·끊김·깨진 JSON 은 15초 뒤 다시. */
export async function askGroqJson(prompt, { images = [], model = GROQ_MODEL } = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY 가 없다(.env 또는 Actions 비밀값)');
  const content = [{ type: 'text', text: prompt }];
  for (const im of images) {
    if (im.label) content.push({ type: 'text', text: im.label });
    content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${im.png.toString('base64')}` } });
  }
  const body = { model, messages: [{ role: 'user', content }], temperature: 0.1, max_tokens: 4096 };
  let err;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${String(j.error?.message || '').slice(0, 200)}`), { status: res.status });
      const text = String(j.choices?.[0]?.message?.content || '').trim();
      const v = parseJsonArray(text);
      if (v) return v;
      throw new Error(`결과가 JSON 배열이 아님: ${text.slice(0, 200)}`);
    } catch (e) {
      err = e;
      console.error(`Groq 실패(${model} ${attempt}회): ${String(e.message).slice(0, 200)}`);
      if (attempt >= 3 || (e.status >= 400 && e.status < 500 && e.status !== 429)) break;
      await new Promise((r) => setTimeout(r, e.status === 429 ? 60_000 : GROQ_WAIT_MS));
    }
  }
  throw err;
}
