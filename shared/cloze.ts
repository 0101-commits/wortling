// 예문 속 표제어 찾기. 카드 예문 굵게(src/ui.tsx Example)와 아침 알림 빈칸(worker/discord.ts)이 같이 쓴다.
// 정확 → 앞부분 일치(합성어·형용사 어미) → 동사 어간(-en/-n/-ern/-eln 뺀 앞부분) 순으로 찾고, 단어 하나를 통째로 돌려준다.

const WORD = /[A-Za-zÄÖÜäöüß]+/g;

/** 예문 de 에서 lemma 에 해당하는 단어 하나의 [시작, 끝). 못 찾으면 null */
export function findWord(de: string, lemma: string): [number, number] | null {
  const base = lemma.replace(/^sich\s+/i, '').trim();
  if (!base) return null;
  const lower = de.toLowerCase();
  const b = base.toLowerCase();
  // 여러 낱말 표제어(숙어 등)는 그대로 찾는다
  if (/\s/.test(b)) {
    const i = lower.indexOf(b);
    return i < 0 ? null : [i, i + b.length];
  }
  const tokens = [...de.matchAll(WORD)].map((m) => ({ s: m.index!, e: m.index! + m[0].length, t: m[0].toLowerCase() }));
  const exact = tokens.find((k) => k.t === b);
  if (exact) return [exact.s, exact.e];
  if (b.length >= 4) {
    const pre = tokens.find((k) => k.t.startsWith(b));
    if (pre) return [pre.s, pre.e];
  }
  const root = b.replace(/(ern|eln|en|n)$/, '');
  if (root.length >= 4 && root !== b) {
    const r = tokens.find((k) => k.t.startsWith(root));
    if (r) return [r.s, r.e];
  }
  return null;
}

/** 빈칸 표시. 디스코드 글꼴에서 밑줄 서식(___)으로 읽히지 않게 전각 밑줄을 쓴다 */
export const BLANK = '＿＿＿';

/** 예문에서 그 단어를 빈칸으로. 못 찾으면 null */
export function clozeOf(de: string, lemma: string): string | null {
  const at = findWord(de, lemma);
  return at ? de.slice(0, at[0]) + BLANK + de.slice(at[1]) : null;
}
