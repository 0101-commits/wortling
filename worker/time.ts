// 한국 시간(UTC+9, 서머타임 없음) 날짜 계산. 의존성 없음.
const KST_MS = 9 * 60 * 60 * 1000;

/** 주어진 시각(기본 지금)이 한국 날짜로 며칠인지 'YYYY-MM-DD' */
export function kstDay(date: Date = new Date()): string {
  return new Date(date.getTime() + KST_MS).toISOString().slice(0, 10);
}

/** 한국 날짜 0시를 UTC ISO 로 ('2026-10-13' → '2026-10-12T15:00:00.000Z') */
export function kstDayStartUtc(day: string): string {
  return new Date(`${day}T00:00:00+09:00`).toISOString();
}

/** 학습일은 새벽 4시에 바뀐다(밤 0~4시 채점은 전날 몫) — 하루 몫·오늘 채점·쉰 날·저녁 조건이 쓴다 */
export const DAY_START_H = 4;

/** 주어진 시각이 몇 일 학습일인지 'YYYY-MM-DD' (한국 시간 04:00 경계) */
export function studyDay(date: Date = new Date()): string {
  return kstDay(new Date(date.getTime() - DAY_START_H * 3_600_000));
}

/** 학습일 시작(그날 04:00 KST)을 UTC ISO 로 ('2026-10-13' → '2026-10-12T19:00:00.000Z') */
export function studyDayStartUtc(day: string): string {
  return new Date(`${day}T0${DAY_START_H}:00:00+09:00`).toISOString();
}

/** 날짜에 n일 더하기(음수 가능) */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** '2026-10-13' → '10/13' (알림 제목용) */
export function monthDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${m}/${d}`;
}

/** 알림 시각(UTC): 07:30 KST = 22:30 UTC 아침, 21:00 KST = 12:00 UTC 저녁 */
export const SLOTS = [
  { kind: 'morning', h: 22, m: 30 },
  { kind: 'evening', h: 12, m: 0 },
] as const;
export type SlotKind = (typeof SLOTS)[number]['kind'];

/** now 보다 뒤인 가장 가까운 알림 칸 */
export function nextSlot(now: Date): { kind: SlotKind; at: Date } {
  let best: { kind: SlotKind; at: Date } | null = null;
  for (const d of [0, 1]) {
    for (const s of SLOTS) {
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, s.h, s.m));
      if (at.getTime() > now.getTime() && (!best || at < best.at)) best = { kind: s.kind, at };
    }
  }
  return best!;
}

/** 다음 알람: 다음 칸과 「1시간 뒤」로 미룬 시각 중 이른 것(worker/alarm.ts) */
export function nextAlarm(slotAt: number, laterAt: number | undefined): number {
  return laterAt !== undefined && laterAt < slotAt ? laterAt : slotAt;
}
