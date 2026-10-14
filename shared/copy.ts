// 알림 문구 표(기획안 v7 A3) — 쉰 날 수에 따라 보르티가 조르다가 스스로 줄인다.
// 금지어(연속 · 정답률 · 외운, worker/discord.ts G6)는 쓰지 않는다. 꾸짖는 말 없이 조르기·서운함까지만.

/** 날짜 문자열(YYYY-MM-DD) 사이 일수 b − a */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

export interface Rest {
  /** 오늘 전까지 한 장도 안 한 학습일 수(어제 했으면 0) */
  rest: number;
  /** 어제 다시 시작했고, 그 전에 3일 이상 쉬었음 → 아침에 한 번 반겨 줌 */
  returning: boolean;
}

/**
 * days = 채점한 학습일 최근 순 2개까지, today = 오늘 학습일, vacation = 휴가 마지막 날(없으면 '').
 * 휴가 기간은 쉰 날로 세지 않는다(마지막 채점일 대신 휴가 끝날을 기준으로).
 */
export function restOf(days: string[], today: string, vacation = ''): Rest {
  const last = days[0];
  if (!last) return { rest: 0, returning: false }; // 처음 쓰는 사람
  if (last >= today) return { rest: 0, returning: false };
  const from = vacation && vacation > last && vacation < today ? vacation : last;
  const rest = Math.max(0, daysBetween(from, today) - 1);
  const returning = rest === 0 && last === from && Boolean(days[1]) && daysBetween(days[1], last) - 1 >= 3;
  return { rest, returning };
}

/** 이만큼 쉬면 알림을 줄인다: 저녁 끔 · 아침은 월요일만 */
export const QUIET_FROM = 4;

const pick = <T,>(list: T[], seed: number) => list[Math.abs(seed) % list.length];

/** 아침 제목. seed = 날짜 숫자(같은 날 같은 문구, 날마다 돌려 씀) */
export function morningTitle(p: { n: number; md: string; rest: number; returning: boolean; seed: number }): string {
  if (p.returning) return `다시 왔다! 오늘 카드 ${p.n} · ${p.md}`;
  if (p.rest >= QUIET_FROM) return `한 주 시작, 카드 ${p.n}장만 · ${p.md}`;
  if (p.rest === 3) return `오늘이 마지막으로 조르는 날이에요 · ${p.md}`;
  if (p.rest === 2) return pick([`보르티 꼬리가 축 처졌어요 · ${p.md}`, `보르티가 문 앞에서 기다려요 · ${p.md}`], p.seed);
  if (p.rest === 1) return pick([`보르티가 어제 카드를 지키고 있어요 · ${p.md}`, `어제 몫이 그대로예요 · ${p.md}`], p.seed);
  return `오늘 카드 ${p.n} · ${p.md}`;
}

/** 저녁 제목. studiedToday = 오늘 이미 채점함(「남은 카드 있으면」 방식일 때만 여기까지 온다) */
export function eveningTitle(p: { n: number; rest: number; studiedToday: boolean; seed: number }): string {
  if (p.studiedToday) return `카드 ${p.n}장 남았어요`;
  if (p.rest >= 3) return `오늘이 마지막으로 조르는 날이에요 · ${p.n}장`;
  if (p.rest === 2) return `보르티 꼬리가 축 처졌어요… ${p.n}장`;
  if (p.rest === 1) return pick([`어제 카드까지 ${p.n}장이에요`, `보르티가 이틀째 기다려요 · ${p.n}장`], p.seed);
  return pick([`보르티가 카드 ${p.n}장 물고 기다려요`, `오늘 카드 ${p.n}장, 아직이에요`], p.seed);
}

/** 이 통을 쉴지: 많이 쉰 사람에게는 저녁 끔, 아침은 월요일만 */
export function quiet(kind: 'morning' | 'evening', rest: number, day: string): boolean {
  if (rest < QUIET_FROM) return false;
  if (kind === 'evening') return true;
  return new Date(day + 'T00:00:00Z').getUTCDay() !== 1;
}

/** 날짜 → 문구 돌림 seed */
export const seedOf = (day: string) => Number(day.replace(/-/g, ''));
