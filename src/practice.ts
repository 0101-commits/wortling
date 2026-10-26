// 학습 방식 틀(기획 v8 과제 4): 재료(배운 카드 + 보기 재료) → 문제 만들기 → 결과.
// 새 방식을 넣을 때는 여기 MODES 에 한 줄 + 문제 만들기 한 개, 화면은 screens/Practice.tsx 에 문제 꼴 하나.
// React 없음(시험에서 바로 부른다).
import type { DeckItem, PoolWord, PracticeMode } from '../shared/api.ts'
import { findAll, findWord } from '../shared/cloze.ts'
import { shuffle } from './deck.ts'

export interface ModeInfo {
  title: string
  desc: string
  /** 목록 아이콘 칸 글자 */
  short: string
}
export const MODES: Record<PracticeMode, ModeInfo> = {
  cloze: { title: '예문 빈칸 고르기', desc: '빈칸에 맞는 단어를 4개 중에서', short: '빈칸' },
  pick: { title: '예문 속 단어 짚기', desc: '뜻에 맞는 낱말을 예문에서 누르기', short: '짚기' },
  meaning: { title: '뜻 고르기', desc: '독일어를 보고 뜻 고르기', short: '뜻' },
  meaning_rev: { title: '독일어 고르기', desc: '뜻을 보고 독일어 고르기', short: '독일어' },
}

/** 보기 하나. id = 단어 id(정답 판정), text = 보이는 글 */
export interface Choice {
  id: string
  text: string
}
/** 4지선다(예문 빈칸 · 뜻 고르기 · 독일어 고르기) */
export interface ChoiceQ {
  mode: 'cloze' | 'meaning' | 'meaning_rev'
  item: DeckItem
  choices: Choice[]
  /** 예문 빈칸: 빈칸 앞 · 예문 속 실제 꼴 · 빈칸 뒤 */
  cloze?: { before: string; hit: string; after: string }
}
/** 예문 속 단어 짚기: 예문 낱말들, hit = 정답 낱말 */
export interface PickQ {
  mode: 'pick'
  item: DeckItem
  tokens: Array<{ text: string; hit: boolean }>
}
export type Question = ChoiceQ | PickQ

/** 움라우트·ß 를 풀어 소문자로(worker/notify.ts 와 같은 규칙) */
const fold = (s: string) => s.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
const bare = (lemma: string) => lemma.replace(/^sich\s+/i, '')

/**
 * 예문을 빈칸 앞 · 실제 꼴 · 뒤로. 못 찾거나 빈칸 밖에 같은 낱말·어간이 남아 정답이 보이면 null
 * (아침 알림 빈칸 문제 pickCloze 와 같은 거르기).
 */
export function clozeParts(de: string, lemma: string, hit?: string | null): ChoiceQ['cloze'] | null {
  const at = findWord(de, lemma, hit)
  if (!at) return null
  const before = de.slice(0, at[0])
  const after = de.slice(at[1])
  const base = fold(bare(lemma))
  const rest = fold(before + ' ' + after)
  if (rest.includes(base)) return null
  const stem = base.length >= 5 ? base.slice(0, 5) : null
  if (stem && (rest.match(/[a-z]+/g) ?? ([] as string[])).some((t) => t.startsWith(stem))) return null
  return { before, hit: de.slice(at[0], at[1]), after }
}

/** 예문 낱말들(띄어쓰기 기준, 문장부호는 붙은 채). 표제어 자리와 겹치는 낱말이 정답(분리동사는 두 조각 다). 못 찾으면 null */
export function pickTokens(de: string, lemma: string, hit?: string | null): PickQ['tokens'] | null {
  const spans = findAll(de, lemma, hit)
  if (!spans.length) return null
  const tokens = [...de.matchAll(/\S+/g)].map((m) => ({ text: m[0], s: m.index!, e: m.index! + m[0].length }))
  const out = tokens.map((t) => ({ text: t.text, hit: spans.some(([s, e]) => t.s < e && t.e > s) }))
  return out.some((t) => t.hit) && out.length >= 3 ? out : null
}

/** 관사 붙인 독일어(명사) */
export const withArticle = (w: Pick<PoolWord, 'lemma' | 'gender' | 'pos'>) =>
  w.pos === 'noun' && w.gender && ['der', 'die', 'das'].includes(w.gender) ? `${w.gender} ${w.lemma}` : w.lemma

/** 뜻 조각(「, 」로 나뉜 것) — 보기끼리 뜻이 겹치면 정답이 둘이 된다 */
const glossParts = (g: string | null) => new Set((g ?? '').split(/[,·;/]/).map((x) => x.trim()).filter(Boolean))

/**
 * 오답 3개: 같은 품사 먼저, 모자라면 다른 품사. 정답과 표제어 · 뜻 조각이 겹치는 것, 서로 같은 글은 뺀다.
 * text = 보이는 글(빈칸 = 기본형, 뜻 고르기 = 뜻, 독일어 고르기 = 관사 붙인 독일어). 3개를 못 채우면 null
 */
export function distractors(
  item: DeckItem,
  pool: PoolWord[],
  text: (w: PoolWord) => string | null,
  rand: () => number = Math.random,
): Choice[] | null {
  const w = item.word
  const ans = glossParts(w.gloss_ko)
  const answerText = text(w)
  if (!answerText) return null
  const ok = (p: PoolWord) =>
    p.id !== w.id &&
    fold(bare(p.lemma)) !== fold(bare(w.lemma)) &&
    ![...glossParts(p.gloss_ko)].some((g) => ans.has(g))
  const same = shuffle(pool.filter((p) => p.pos === w.pos && ok(p)), rand)
  const other = shuffle(pool.filter((p) => p.pos !== w.pos && ok(p)), rand)
  const seen = new Set([answerText])
  const out: Choice[] = []
  for (const p of [...same, ...other]) {
    const t = text(p)
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push({ id: p.id, text: t })
    if (out.length === 3) return out
  }
  return null
}

/** 문제 하나. 못 만들면 null(예문 없음 · 예문에서 단어를 못 찾음 · 보기 모자람) */
export function makeQuestion(mode: PracticeMode, item: DeckItem, pool: PoolWord[], rand: () => number = Math.random): Question | null {
  const w = item.word
  if (mode === 'pick') {
    if (!w.example_de || !w.gloss_ko) return null
    const tokens = pickTokens(w.example_de, w.lemma, w.example_hit)
    return tokens ? { mode, item, tokens } : null
  }
  if (mode === 'cloze') {
    if (!w.example_de) return null
    const cloze = clozeParts(w.example_de, w.lemma, w.example_hit)
    if (!cloze) return null
    const wrong = distractors(item, pool, (p) => p.lemma, rand)
    return wrong ? { mode, item, cloze, choices: shuffle([{ id: w.id, text: w.lemma }, ...wrong], rand) } : null
  }
  if (!w.gloss_ko) return null
  const text = mode === 'meaning' ? (p: PoolWord) => p.gloss_ko : (p: PoolWord) => withArticle(p)
  const wrong = distractors(item, pool, text, rand)
  const right = text(w)
  return wrong && right ? { mode, item, choices: shuffle([{ id: w.id, text: right }, ...wrong], rand) } : null
}

/** 재료에서 문제 n 개(만들 수 있는 것만, 순서는 섞어서) */
export function makeQuestions(mode: PracticeMode, items: DeckItem[], pool: PoolWord[], n: number, rand: () => number = Math.random): Question[] {
  const out: Question[] = []
  for (const it of shuffle(items, rand)) {
    const q = makeQuestion(mode, it, pool, rand)
    if (q) out.push(q)
    if (out.length >= n) break
  }
  return out
}
