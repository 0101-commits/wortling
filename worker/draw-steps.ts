import { bad } from './http.ts';

/** steps 는 schnell(최대 8)·flux-2-dev(최대 20)만 받는다 — 빠지면 undefined = 모델 기본값. 숫자가 아니거나 1 미만이면 400, 상한 넘으면 상한으로 줄인다. 다른 모델은 무시 */
export function drawSteps(model: string, raw: unknown): number | undefined {
  const max = model.endsWith('flux-1-schnell') ? 8 : model.endsWith('flux-2-dev') ? 20 : 0;
  if (raw === undefined || raw === null || !max) return undefined;
  const n = Number(raw);
  if (typeof raw === 'boolean' || !Number.isFinite(n) || n < 1) throw bad('steps');
  return Math.min(max, Math.round(n));
}
