// 날짜·상태 표기 도우미
import type { Card, CardState, DeckItem, Word } from '../shared/api.ts'

export const STATE_LABEL: Record<CardState, string> = { 0: '새 단어', 1: '학습 중', 2: '복습', 3: '다시 학습' }

export function article(w: Word): string {
  return w.pos === 'noun' && w.gender ? w.gender : ''
}

export function articleClass(w: Word): string {
  const a = article(w)
  return a === 'der' || a === 'die' || a === 'das' ? a : ''
}

/** 학습일 YYYY-MM-DD — 한국 시간 새벽 4시에 바뀐다(worker/time.ts studyDay 와 같은 규칙) */
export function studyDay(now = new Date()): string {
  return new Date(now.getTime() + (9 - 4) * 3_600_000).toISOString().slice(0, 10)
}

/** iso 시각의 학습일 − 오늘 학습일(일) */
export function dayDiff(iso: string, now = new Date()): number {
  const a = Date.parse(studyDay(now) + 'T00:00:00Z')
  const b = Date.parse(studyDay(new Date(iso)) + 'T00:00:00Z')
  return Math.round((b - a) / 86_400_000)
}

/**
 * 카드 앞면 표지(B2): 마지막으로 본 게 언제인지 사람 말로. tone = 색(new 청록 · again 주황 · plain 회색)
 * 새 단어 · 다시 익히는 중(잊었다 다시) · 오늘 또 · 어제 본 단어 · N일 만에 다시 · N개월 만에 다시
 */
export function seenLabel(card: Card, now = new Date()): { text: string; tone: 'new' | 'again' | 'plain' } {
  if (card.state === 0 || !card.last_review) return { text: '새 단어', tone: 'new' }
  if (card.state === 3) return { text: '다시 익히는 중', tone: 'again' }
  const d = -dayDiff(card.last_review, now)
  if (d <= 0) return { text: '오늘 또', tone: 'plain' }
  if (d === 1) return { text: '어제 본 단어', tone: 'plain' }
  if (d >= 30) return { text: `${Math.floor(d / 30)}개월 만에 다시`, tone: 'again' }
  return { text: `${d}일 만에 다시`, tone: d >= 7 ? 'again' : 'plain' }
}

/** 목록 오른쪽 작은 글자 */
export function dueText(item: DeckItem, now = new Date()): string {
  const { card } = item
  if (card.state === 0) return '아직'
  const d = dayDiff(card.due, now)
  if (d <= 0) return '오늘'
  if (d === 1) return '내일'
  if (card.state === 2 && card.stability >= 30) return `안정 ${Math.round(card.stability)}일`
  return `${d}일 뒤`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtDay(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00+09:00' : iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function num(n: number): string {
  return n.toLocaleString('ko-KR')
}
