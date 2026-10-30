// 하루 몫 장부 — Workers AI 뉴런(그림) · 그림 검사 AI 사용량(Groq 토큰 · Gemini 요청). daily.mjs · judge.mjs 가 같이 쓴다.
// 저장: .data/ledger.json (draw-day.json 처럼 깃허브 Actions 가 main 에 되올린다 — daily.yml 「그림 상태 되올리기」). 날짜 키는 UTC(무료 몫 초기화 기준).
// 하는 일
//   G1 모델별 뉴런 값(공식 가격) · 하루 예산(10,000 − 여유) · 그린 만큼 적기
//   G2 모델 섞기 — 처음 3일 50/50, 그 뒤 「통과한 그림 / 쓴 뉴런」 비율로 나누되 모델마다 바닥 20%
//   G3 어려운 단어(검사 두 번 탈락) 다시 그리기 몫
//   P5 검사 AI 사용량 장부 + 손 실행이 예약 실행 몫(기본 40%)을 건드리지 않게 막기
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const KLEIN4 = '@cf/black-forest-labs/flux-2-klein-4b';
export const SCHNELL = '@cf/black-forest-labs/flux-1-schnell';
export const KLEIN9 = '@cf/black-forest-labs/flux-2-klein-9b';
export const DEV = '@cf/black-forest-labs/flux-2-dev';
/** 매일 섞어 그리는 모델(참고 그림 있는 쪽 · 글자만 쪽) */
export const MIX_MODELS = [KLEIN4, SCHNELL];

// 그릴 크기 · 걸음 수 — 값은 공식 문서(models/…) 기준. schnell 은 width/height 입력이 없어 정사각(1024²)으로 어림
export const SIZE = { [KLEIN4]: [1024, 768], [SCHNELL]: [1024, 1024], [KLEIN9]: [1024, 768], [DEV]: [1024, 768] };
const TILE = 512 * 512;
const tiles = (w, h) => Math.ceil((w * h) / TILE);
const REF_W = 512, REF_H = 512; // borti-ref.png 는 512² 이하

/** 공식 가격표대로 한 장 뉴런(보정 전). steps 는 schnell(기본 4 · 최대 8) · dev 만 쓴다 */
export function neuronCost(model, { w, h, steps, ref = true } = {}) {
  const [dw, dh] = SIZE[model] ?? [1024, 768];
  w ??= dw;
  h ??= dh;
  const t = tiles(w, h);
  const refTiles = ref ? tiles(REF_W, REF_H) : 0;
  if (model === KLEIN4) return 5.37 * refTiles + 26.05 * t;
  if (model === SCHNELL) return 4.8 * t + 9.6 * (steps ?? 4); // 참고 그림 입력 없음
  if (model === KLEIN9) {
    const mp = (w * h) / 1e6;
    const out = 1363.64 + 181.82 * Math.max(0, mp - 1);
    return out + (ref ? 181.82 * ((REF_W * REF_H) / 1e6) : 0);
  }
  if (model === DEV) return (37.5 * t + 18.75 * refTiles) * (steps ?? 20);
  throw new Error(`뉴런 값을 모르는 모델: ${model}`);
}

/** 설정(환경값). 시험은 env 를 넘긴다 */
export function ledgerConfig(env = process.env) {
  const num = (k, d) => (Number.isFinite(Number(env[k])) && env[k] !== undefined && env[k] !== '' ? Number(env[k]) : d);
  const scheduled = (env.DAILY_RUN_KIND || (env.GITHUB_EVENT_NAME === 'schedule' ? 'scheduled' : 'manual')) === 'scheduled';
  return {
    budget: num('NEURON_DAILY', 10_000) - num('NEURON_MARGIN', 1000), // 쓸 수 있는 뉴런
    factor: num('NEURON_FACTOR', 1.3), // 대시보드 실측 ≈ 계산의 1.3배(2026-10-19, klein-4b)
    phaseDays: num('MIX_PHASE_DAYS', 3),
    floor: num('MIX_FLOOR', 0.2),
    schnellSteps: num('SCHNELL_STEPS', 4),
    devSteps: num('DEV_STEPS', 20),
    hardMax: num('DAILY_HARD_MAX', 1),
    hardModel: env.DAILY_HARD_MODEL === 'dev' || env.DAILY_HARD_MODEL === DEV ? DEV : KLEIN9, // 기본 9b, dev 는 환경값으로만
    hardFails: num('HARD_FAILS', 2),
    manual: !scheduled,
    reserve: num('JUDGE_RESERVE', 0.4), // 손 실행이 건드리지 않는 예약 실행 몫
    limits: { groq: num('GROQ_TPD', 200_000), gemini: num('GEMINI_RPD', 20) }, // groq = 하루 토큰 · gemini = 하루 요청
    estimate: { groq: num('GROQ_EST_TOKENS', 7000), gemini: 1 }, // 한 번 부를 때 어림(오늘 실측 평균이 있으면 그것)
  };
}

/** 모델 한 장 뉴런(보정 포함) — 장부에 적는 값 */
export function neuronEstimate(model, cfg = ledgerConfig(), opts = {}) {
  const steps = model === SCHNELL ? cfg.schnellSteps : model === DEV ? cfg.devSteps : undefined;
  return neuronCost(model, { steps, ...opts }) * cfg.factor;
}

// ── 장부 ────────────────────────────────────────────────────────────────
export const emptyLedger = () => ({ version: 1, start: null, days: {}, stats: {}, fails: {}, hard_tried: {}, drawn_by: {} });

export function loadLedger(file) {
  try {
    return { ...emptyLedger(), ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    return emptyLedger(); // 없거나 깨졌으면 새로
  }
}

/** 저장. 날짜는 14일치만 · drawn_by 는 최근 3,000장만 남긴다 */
export function saveLedger(file, l) {
  const keep = Object.keys(l.days).sort().slice(-14);
  for (const d of Object.keys(l.days)) if (!keep.includes(d)) delete l.days[d];
  const by = Object.entries(l.drawn_by);
  if (by.length > 3000) l.drawn_by = Object.fromEntries(by.slice(-3000));
  writeFileSync(file, JSON.stringify(l));
}

export function dayRec(l, day) {
  return (l.days[day] ??= { neurons: {}, drawn: {}, judge: {} });
}
const stat = (l, m) => (l.stats[m] ??= { drawn: 0, auto_pass: 0, judge_pass: 0, judge_fail: 0, neurons: 0 });
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
export const spentToday = (l, day) => sum(dayRec(l, day).neurons);

/** 그림 한 번(실패한 요청은 부르는 쪽이 안 부름) */
export function recordDraw(l, day, model, neurons) {
  const d = dayRec(l, day);
  d.neurons[model] = (d.neurons[model] ?? 0) + neurons;
  d.drawn[model] = (d.drawn[model] ?? 0) + 1;
  const s = stat(l, model);
  s.drawn++;
  s.neurons += neurons;
  if (MIX_MODELS.includes(model)) l.start ??= day; // 섞기 시작한 날
}
export const recordAuto = (l, model, ok) => {
  if (ok) stat(l, model).auto_pass++;
};
/** 뜻 검사 결과를 그린 모델에 붙인다(id → 모델은 drawn_by). 탈락이면 단어별 탈락 횟수도 센다 */
export function recordJudge(l, id, model, ok) {
  if (model) stat(l, model)[ok ? 'judge_pass' : 'judge_fail']++;
  if (ok) delete l.fails[id];
  else l.fails[id] = (l.fails[id] ?? 0) + 1;
}

// ── 모델 섞기(G2) ───────────────────────────────────────────────────────
/** 모델별 뉴런 몫 비율(합 1). 처음 phaseDays 일 · 자료가 모자라면 균등, 그 뒤 「통과 그림 / 뉴런」 비례에 바닥 floor */
export function allocateShares(l, day, cfg = ledgerConfig(), models = MIX_MODELS) {
  const n = models.length;
  const equal = Object.fromEntries(models.map((m) => [m, 1 / n]));
  const since = l.start ? Math.round((Date.parse(day) - Date.parse(l.start)) / 86_400_000) : 0;
  if (since < cfg.phaseDays) return equal;
  const eff = models.map((m) => (stat(l, m).neurons > 0 ? stat(l, m).judge_pass / stat(l, m).neurons : 0));
  const total = sum(eff);
  if (!total) return equal;
  const f = Math.min(cfg.floor, 1 / n);
  // 바닥(floor) 아래는 바닥으로 올리고, 나머지는 비율을 지킨 채 줄인다
  const out = Object.fromEntries(models.map((m, i) => [m, eff[i] / total]));
  const pinned = new Set();
  for (let again = true; again; ) {
    again = false;
    const free = models.filter((m) => !pinned.has(m));
    const left = 1 - pinned.size * f;
    const freeSum = sum(Object.fromEntries(free.map((m) => [m, out[m]])));
    for (const m of free) {
      out[m] = freeSum ? (out[m] / freeSum) * left : left / free.length;
      if (out[m] < f) { out[m] = f; pinned.add(m); again = true; }
    }
    for (const m of pinned) out[m] = f;
  }
  return out;
}

/** 다음에 그릴 모델 → {model, cost} · 오늘 예산이 모자라면 null(그리기 멈춤).
 *  몫 = 비율 × (예산 − 어려운 단어 다시 그리기에 쓴 뉴런). 몫이 가장 많이 남은 모델부터 */
export function pickModel(l, day, cfg = ledgerConfig(), models = MIX_MODELS) {
  const d = dayRec(l, day);
  const avail = cfg.budget - sum(d.neurons);
  const pool = cfg.budget - sum(Object.fromEntries(Object.entries(d.neurons).filter(([m]) => !models.includes(m))));
  const shares = allocateShares(l, day, cfg, models);
  let best = null;
  for (const m of models) {
    const cost = neuronEstimate(m, cfg);
    const rem = shares[m] * pool - (d.neurons[m] ?? 0);
    if (cost > avail || rem <= 0) continue;
    if (!best || rem > best.rem) best = { model: m, cost, rem };
  }
  return best && { model: best.model, cost: best.cost };
}

// ── 어려운 단어(G3) ─────────────────────────────────────────────────────
/** 검사 hardFails 번 이상 탈락했고 아직 어려운 모델로 안 그린 단어 id */
export const hardCandidates = (l, cfg = ledgerConfig()) => Object.keys(l.fails).filter((id) => l.fails[id] >= cfg.hardFails && !l.hard_tried[id]);

/** 오늘 어려운 단어 몫이 남았나(횟수 + 뉴런) → 비용 · 아니면 null */
export function hardSlot(l, day, cfg = ledgerConfig()) {
  const d = dayRec(l, day);
  if ((d.drawn[cfg.hardModel] ?? 0) >= cfg.hardMax) return null;
  const cost = neuronEstimate(cfg.hardModel, cfg);
  return cost <= cfg.budget - sum(d.neurons) ? cost : null;
}

// ── 검사 AI 사용량(P5) ──────────────────────────────────────────────────
/** 검사 AI 한 번 부른 값을 적는다. 단위: groq = 토큰 · gemini = 요청 수(토큰은 참고로 같이) */
export function recordJudgeUsage(l, day, provider, tokens = 0) {
  const j = ((dayRec(l, day).judge[provider] ??= { requests: 0, tokens: 0 }));
  j.requests++;
  j.tokens += tokens;
}
const usedOf = (l, day, p) => {
  const j = dayRec(l, day).judge[p] ?? { requests: 0, tokens: 0 };
  return p === 'groq' ? j.tokens : j.requests;
};

/** 지금 이 검사 AI 를 불러도 되나. 예약 실행은 한도까지, 손 실행은 (1 − reserve) 까지만 */
export function judgeAllowed(l, day, provider, cfg = ledgerConfig()) {
  const limit = cfg.limits[provider];
  if (!limit) return true;
  const used = usedOf(l, day, provider);
  const j = dayRec(l, day).judge[provider];
  const est = j?.requests ? (provider === 'groq' ? j.tokens / j.requests : 1) : cfg.estimate[provider];
  const cap = cfg.manual ? limit * (1 - cfg.reserve) : limit;
  return used + est <= cap;
}
