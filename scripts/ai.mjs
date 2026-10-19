// Gemini 한 번 불러 JSON 배열을 받는다. 매일 작업(글·장면 쓰기 · 카드 검토 · 뉴스 단어)과 그림 뜻 검사(judge.mjs)가 같이 쓴다.
// 2026-10-19 사용자 「claude 말고 다른 AI 로」 — 예전 claude -p 는 구독 토큰(CLAUDE_CODE_OAUTH_TOKEN)이라 클로드 코드 한도를 같이 깎았다.
// 이제 Gemini 무료 몫(GEMINI_API_KEY). 키는 헤더로(URL 에 넣으면 오류 문구에 찍힌다).
// Google 이 모델을 조용히 퇴역시킨다(economic-site 2026-09-15 실측 404) → 별칭을 쓰고, 한도(429)·퇴역(404)이면 다음 모델로.
import { readFileSync } from 'node:fs';

const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];

const total = { calls: 0, input: 0, output: 0, thinking: 0 };
process.on('exit', () => {
  if (total.calls) console.error(`AI 합계: ${total.calls}번 · 입력 ${total.input} · 출력 ${total.output} · 생각 ${total.thinking}`);
});

async function once(model, body, key) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  const j = await res.json().catch(() => ({}));
  // 하루 몫 소진(429 …PerDay…)은 1분 기다려도 그대로 → 곧장 다음 모델(final)
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${String(j.error?.message || '').slice(0, 200)}`), { status: res.status, final: /PerDay/i.test(JSON.stringify(j.error?.details ?? '')) });
  const u = j.usageMetadata || {};
  const n = { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0, thinking: u.thoughtsTokenCount || 0 };
  total.calls++;
  for (const k of Object.keys(n)) total[k] += n[k];
  console.error(`AI 사용량(${model}): 입력 ${n.input} · 출력 ${n.output} · 생각 ${n.thinking}`);
  const c = j.candidates?.[0];
  const text = (c?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  // 그대로 → 앞뒤 말·코드 울타리를 떼고 [ … ] → { … } 차례로 읽어 본다
  let v;
  for (const s of [text, text.slice(text.indexOf('['), text.lastIndexOf(']') + 1), text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    try { v = JSON.parse(s); break; } catch { /* 다음 */ }
  }
  // 항목이 하나면 [{…}] 대신 {…} 로, 가끔 {"items": […]} 처럼 감싸 온다
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const vals = Object.values(v);
    v = vals.length === 1 && Array.isArray(vals[0]) ? vals[0] : [v];
  }
  if (Array.isArray(v)) return v;
  // 막힌 응답은 다시 물어도 같다 → final
  const blocked = Boolean(j.promptFeedback?.blockReason) || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(c?.finishReason);
  throw Object.assign(new Error(`결과가 JSON 배열이 아님(${c?.finishReason || j.promptFeedback?.blockReason || '?'}): ${text.slice(0, 200)}`), { final: blocked });
}

/** prompt → JSON 배열. images = PNG 파일 경로(judge.mjs 의 모음 그림) — 글 뒤에 차례대로 붙인다.
 *  모델마다 두 번까지: 429 는 1분, 5xx·끊김·깨진 JSON 은 5초 뒤 다시. 404·그 밖 4xx·하루 몫 소진·막힘은 곧장 다음 모델. 다 실패면 던진다 */
export async function askJson(prompt, { images = [] } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 가 없다(.env 또는 Actions 비밀값)');
  const parts = [{ text: prompt }, ...images.map((f) => ({ inline_data: { mime_type: 'image/png', data: readFileSync(f).toString('base64') } }))];
  const body = { contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json' } };
  let err;
  for (const model of MODELS) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(model, body, key);
      } catch (e) {
        err = e;
        console.error(`AI 실패(${model} ${attempt}회): ${String(e.message).slice(0, 160)}`);
        if (e.final || attempt >= 2 || (e.status >= 400 && e.status < 500 && e.status !== 429)) break;
        await new Promise((r) => setTimeout(r, e.status === 429 ? 60_000 : 5_000));
      }
    }
  }
  throw err;
}
