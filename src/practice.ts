// 학습 방식 틀(기획 v8 과제 4): 재료(배운 카드 + 보기 재료) → 문제 만들기 → 결과.
// 새 방식을 넣을 때는 여기 MODES 에 한 줄 + 문제 만들기 한 개, 화면은 screens/Practice.tsx 에 문제 꼴 하나.
// React 없음(시험에서 바로 부른다).
import type { DeckItem, PoolWord, PracticeMode } from '../shared/api.ts'
import { findWord } from '../shared/cloze.ts'
import { shuffle } from './deck.ts'

export interface ModeInfo {
  title: string
  desc: string
  /** 목록 아이콘 칸 글자 */
  short: string
}
export const MODES: Record<PracticeMode, ModeInfo> = {
  cloze: { title: '예문 빈칸 고르기', desc: '빈칸에 맞는 단어를 4개 중에서', short: '빈칸' },
  match: { title: '짝 맞추기', desc: '독일어 5개와 뜻 5개를 짝지어 누르기', short: '짝' },
  meaning: { title: '뜻 고르기', desc: '독일어를 보고 뜻 고르기', short: '뜻' },
  meaning_rev: { title: '독일어 고르기', desc: '뜻을 보고 독일어 고르기', short: '독일어' },
  write: { title: '독일어 쓰기', desc: '뜻을 보고 독일어 쓰기', short: '쓰기' },
}

/** 보기 하나. id = 단어 id(정답 판정), text = 보이는 글, word = 그 보기 단어(답한 뒤 뜻·독일어를 보여 준다) */
export interface Choice {
  id: string
  text: string
  word: PoolWord
}
/** 4지선다(예문 빈칸 · 뜻 고르기 · 독일어 고르기) */
export interface ChoiceQ {
  mode: 'cloze' | 'meaning' | 'meaning_rev'
  item: DeckItem
  choices: Choice[]
  /** 예문 빈칸: 빈칸 앞 · 예문 속 실제 꼴 · 빈칸 뒤 */
  cloze?: { before: string; hit: string; after: string }
}
/** 짝 맞추기: 단어 3~5개, 왼쪽 독일어 · 오른쪽 뜻(따로 섞음). 짝 판정은 id 로 */
export interface MatchQ {
  mode: 'match'
  items: DeckItem[]
  left: Choice[]
  right: Choice[]
}
/** 독일어 쓰기: 뜻을 보고 직접 입력. 보기는 없음 */
export interface WriteQ {
  mode: 'write'
  item: DeckItem
}
export type Question = ChoiceQ | MatchQ | WriteQ

/** 짝 맞추기 한 판의 단어 수(마지막 판은 MATCH_MIN 까지 적을 수 있음) */
export const MATCH_SIZE = 5
const MATCH_MIN = 3

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

/** 관사 붙인 독일어(명사) */
export const withArticle = (w: Pick<PoolWord, 'lemma' | 'gender' | 'pos'>) =>
  w.pos === 'noun' && w.gender && ['der', 'die', 'das'].includes(w.gender) ? `${w.gender} ${w.lemma}` : w.lemma

/** 뜻 조각(「, 」로 나뉜 것) — 보기끼리 뜻이 겹치면 정답이 둘이 된다 */
const glossParts = (g: string | null) => new Set((g ?? '').split(/[,·;/]/).map((x) => x.trim()).filter(Boolean))
const overlaps = (a: Set<string>, b: Set<string>) => [...a].some((g) => b.has(g))

/** 카드 단어 → 보기 재료 꼴 */
const poolOf = (w: DeckItem['word']): PoolWord => ({ id: w.id, lemma: w.lemma, pos: w.pos, gender: w.gender, gloss_ko: w.gloss_ko })

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
  const ok = (p: PoolWord) => p.id !== w.id && fold(bare(p.lemma)) !== fold(bare(w.lemma)) && !overlaps(glossParts(p.gloss_ko), ans)
  const same = shuffle(pool.filter((p) => p.pos === w.pos && ok(p)), rand)
  const other = shuffle(pool.filter((p) => p.pos !== w.pos && ok(p)), rand)
  const seen = new Set([answerText])
  const out: Choice[] = []
  for (const p of [...same, ...other]) {
    const t = text(p)
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push({ id: p.id, text: t, word: p })
    if (out.length === 3) return out
  }
  return null
}

/** 4지선다 문제 하나. 못 만들면 null(예문 없음 · 예문에서 단어를 못 찾음 · 보기 모자람) */
export function makeQuestion(mode: ChoiceQ['mode'], item: DeckItem, pool: PoolWord[], rand: () => number = Math.random): ChoiceQ | null {
  const w = item.word
  if (mode === 'cloze') {
    if (!w.example_de) return null
    const cloze = clozeParts(w.example_de, w.lemma, w.example_hit)
    if (!cloze) return null
    const wrong = distractors(item, pool, (p) => p.lemma, rand)
    return wrong ? { mode, item, cloze, choices: shuffle([{ id: w.id, text: w.lemma, word: poolOf(w) }, ...wrong], rand) } : null
  }
  if (!w.gloss_ko) return null
  const text = mode === 'meaning' ? (p: PoolWord) => p.gloss_ko : (p: PoolWord) => withArticle(p)
  const wrong = distractors(item, pool, text, rand)
  const right = text(w)
  return wrong && right ? { mode, item, choices: shuffle([{ id: w.id, text: right, word: poolOf(w) }, ...wrong], rand) } : null
}

/** 한 판에 같이 두면 짝이 둘이 되는 두 단어: 표제어 · 보이는 독일어 · 뜻(조각)이 겹침 */
const clash = (a: DeckItem['word'], b: DeckItem['word']) =>
  fold(bare(a.lemma)) === fold(bare(b.lemma)) || withArticle(a) === withArticle(b) || overlaps(glossParts(a.gloss_ko), glossParts(b.gloss_ko))

/**
 * 짝 맞추기 판들: 뜻 있는 카드를 섞어 단어 n 개까지, 판 크기는 고르게(7개 → 4 + 3). 한 판 안에는 서로 겹치는 단어를 안 넣는다.
 * 겹쳐서 못 넣은 판이 MATCH_MIN 보다 적으면 버린다.
 */
export function makeMatches(items: DeckItem[], n: number, rand: () => number = Math.random): MatchQ[] {
  const cands = shuffle(items.filter((it) => it.word.gloss_ko), rand)
  const take = Math.min(n, cands.length)
  if (take < MATCH_MIN) return []
  const k = Math.ceil(take / MATCH_SIZE)
  const cap = Math.ceil(take / k)
  const groups: DeckItem[][] = Array.from({ length: k }, () => [])
  for (const it of cands) {
    const g = groups.find((g) => g.length < cap && g.every((o) => !clash(o.word, it.word)))
    if (g) g.push(it)
    if (groups.every((g) => g.length >= cap)) break
  }
  return groups
    .filter((g) => g.length >= MATCH_MIN)
    .map((g) => {
      const pairs = g.map((it) => ({ it, word: poolOf(it.word) }))
      return {
        mode: 'match' as const,
        items: g,
        left: shuffle(pairs.map((p) => ({ id: p.word.id, text: withArticle(p.word), word: p.word })), rand),
        right: shuffle(pairs.map((p) => ({ id: p.word.id, text: p.word.gloss_ko!, word: p.word })), rand),
      }
    })
}

/** 재료에서 문제 n 개(만들 수 있는 것만, 순서는 섞어서). 짝 맞추기는 n = 단어 수 */
export function makeQuestions(mode: PracticeMode, items: DeckItem[], pool: PoolWord[], n: number, rand: () => number = Math.random): Question[] {
  if (mode === 'match') return makeMatches(items, n, rand)
  if (mode === 'write') {
    const out: WriteQ[] = []
    for (const it of shuffle(items, rand)) {
      if (!it.word.gloss_ko) continue
      out.push({ mode, item: it })
      if (out.length >= n) break
    }
    return out
  }
  const out: ChoiceQ[] = []
  for (const it of shuffle(items, rand)) {
    const q = makeQuestion(mode as ChoiceQ['mode'], it, pool, rand)
    if (q) out.push(q)
    if (out.length >= n) break
  }
  return out
}

/** 문제에 든 단어 수(짝 맞추기는 판마다 여러 개) */
export const wordsIn = (q: Question) => (q.mode === 'match' ? q.items.length : 1)

const ARTICLES = ['der', 'die', 'das']
/** 쓰기 비교용: fold 에 더해 ae·oe·ue 도 ä·ö·ü 와 같게(ä→a 로 풀어 쓴 것과 ae 로 쓴 것 모두 맞으로) */
const foldWrite = (s: string) => fold(s.trim().replace(/\s+/g, ' ')).replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')

/**
 * 쓰기 정답 판정: 표제어(sich 는 빼고 봐준다) · 복수형(데이터에 있으면)을 관사 있이/없이, 대소문자·앞뒤 공백 무시,
 * ä/ae · ö/oe · ü/ue · ß/ss 모두 같게. 관사를 썼는데 단어의 관사와 다르면 틀림(복수는 die)
 */
export function checkWrite(item: DeckItem, input: string): boolean {
  const w = item.word
  const words = input.trim().split(/\s+/)
  const art = ARTICLES.includes(words[0]?.toLowerCase()) && words.length > 1 ? words.shift()!.toLowerCase() : null
  const got = foldWrite(words.join(' '))
  if (!got) return false
  // 표제어 자체가 관사로 시작하는 낱말은 통째로도 비교
  if (foldWrite(bare(w.lemma)) === foldWrite(bare(input))) return true
  const genders = w.pos === 'noun' && w.gender ? w.gender.toLowerCase().split(/[/,\s]+/).filter((g) => ARTICLES.includes(g)) : []
  if (foldWrite(bare(w.lemma)) === got && (!art || !genders.length || genders.includes(art))) return true
  const plurals = w.plural ? w.plural.split(/[,/;]/).map((p) => foldWrite(p.replace(/^(der|die|das)\s+/i, ''))) : []
  return plurals.includes(got) && (!art || art === 'die')
}
