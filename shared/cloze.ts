// 예문 속 표제어 찾기. 카드 예문 굵게(src/ui.tsx Example)와 아침 알림 빈칸(worker/discord.ts), 더 공부하기 문제(src/practice.ts)가 같이 쓴다.
// 정확 → 앞부분 일치(합성어·형용사 어미) → 동사 어간(-en/-n/-ern/-eln 뺀 앞부분) 순으로 찾고, 단어 하나를 통째로 돌려준다.
// 이 규칙으로 못 찾는 꼴(불규칙 과거분사 gerettet · 분리동사 gebe … auf · 모음 바뀜 wirf)은 단어 작업이 words.example_hit 에
// 예문 속 실제 낱말을 적어 둔다(scripts/words/hits.mjs, 기획 v8 W1) — hit 로 넘기면 그 낱말을 찾는다.

const WORD = /[A-Za-zÄÖÜäöüß]+/g;

/** example_hit 값: 'gebe|auf' 처럼 예문 속 낱말을 | 로 이음. '-' = AI 도 못 찾음(다시 안 물음) */
export const HIT_NONE = '-';

const tokensOf = (de: string) => [...de.matchAll(WORD)].map((m) => ({ s: m.index!, e: m.index! + m[0].length, t: m[0].toLowerCase() }));
const hitForms = (hit: string | null | undefined) =>
  hit && hit !== HIT_NONE ? hit.split('|').map((x) => x.trim().toLowerCase()).filter(Boolean) : [];

/** 예문 de 에서 lemma 에 해당하는 단어 하나의 [시작, 끝). 못 찾으면 hit(예문 속 낱말)의 첫 낱말, 그것도 없으면 null */
export function findWord(de: string, lemma: string, hit?: string | null): [number, number] | null {
  const base = lemma.replace(/^sich\s+/i, '').trim();
  if (!base) return null;
  const lower = de.toLowerCase();
  const b = base.toLowerCase();
  // 여러 낱말 표제어(숙어 등)는 그대로 찾는다
  if (/\s/.test(b)) {
    const i = lower.indexOf(b);
    if (i >= 0) return [i, i + b.length];
    return hitSpans(de, hit)[0] ?? null;
  }
  const tokens = tokensOf(de);
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
  return hitSpans(de, hit)[0] ?? null;
}

/** hit 의 낱말마다 예문 속 자리(앞에서부터 차례로 찾음). 예문에 없는 낱말은 건너뛴다 */
export function hitSpans(de: string, hit: string | null | undefined): Array<[number, number]> {
  const tokens = tokensOf(de);
  const out: Array<[number, number]> = [];
  let from = 0;
  for (const f of hitForms(hit)) {
    const i = tokens.findIndex((k, j) => j >= from && k.t === f);
    if (i < 0) continue;
    out.push([tokens[i].s, tokens[i].e]);
    from = i + 1;
  }
  return out;
}

/** 표제어 자리 전부: 찾기 규칙으로 찾으면 그 하나, 못 찾으면 hit 의 낱말 전부(분리동사 두 조각) */
export function findAll(de: string, lemma: string, hit?: string | null): Array<[number, number]> {
  const one = findWord(de, lemma);
  if (one) return [one];
  return hitSpans(de, hit);
}

/** 빈칸 표시. 디스코드 글꼴에서 밑줄 서식(___)으로 읽히지 않게 전각 밑줄을 쓴다 */
export const BLANK = '＿＿＿';

/** 예문에서 그 단어를 빈칸으로. 못 찾으면 null */
export function clozeOf(de: string, lemma: string, hit?: string | null): string | null {
  const at = findWord(de, lemma, hit);
  return at ? de.slice(0, at[0]) + BLANK + de.slice(at[1]) : null;
}
