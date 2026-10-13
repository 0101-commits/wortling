// 날짜·상태 표기 도우미
import type { CardState, DeckItem, Word } from '../shared/api.ts'

export const STATE_LABEL: Record<CardState, string> = { 0: '새 단어', 1: '학습 중', 2: '복습', 3: '다시 학습' }

export function article(w: Word): string {
  return w.pos === 'noun' && w.gender ? w.gender : ''
}

export function articleClass(w: Word): string {
  const a = article(w)
  return a === 'der' || a === 'die' || a === 'das' ? a : ''
}

/** YYYY-MM-DD (KST 기준 오늘) */
export function todayKst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

export function dayDiff(iso: string, now = new Date()): number {
  const a = new Date(todayKst(now) + 'T00:00:00+09:00').getTime()
  const b = new Date(todayKst(new Date(iso)) + 'T00:00:00+09:00').getTime()
  return Math.round((b - a) / 86_400_000)
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
