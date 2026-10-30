// 여러 화면이 같이 쓰는 작은 부품
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { animate } from 'motion/react'
import { Button, ContentBadge, IconButton, TopNavigation, TopNavigationButton, useRegionStore, type ThemeColorsToken } from '@montage-ui/core'
import { IconBell, IconChevronLeft, IconMinus, IconPlus, IconSetting } from '@montage-ui/icon'
import type { Level, Pos, Word } from '../shared/api.ts'
import { imgSrc } from './api.ts'
import { article } from './format.ts'
import { goBack, navigate } from './router.ts'
import { findAll } from '../shared/cloze.ts'

/** 보르티 이모티콘(public/emoji/{name}.webp, 256×256). 꾸밈이라 alt 는 비운다. */
export type EmojiName = 'hello' | 'happy' | 'sleep' | 'party' | 'oops' | 'study' | 'mail' | 'think'
export function Emoji({ name, size = 96, className = '' }: { name: EmojiName; size?: number; className?: string }) {
  return <img className={'emoji ' + className} src={`/emoji/${name}.webp`} width={size} height={size} alt="" draggable={false} />
}

type ToastVariant = 'normal' | 'positive' | 'cautionary' | 'negative'
/** montage 토스트. useToast 는 매 렌더 새 함수를 돌려줘 effect 의존성에 못 쓴다 → 저장소의 add(고정)로 감싼다.
 *  오류 토스트는 당황한 보르티(oops)가 아이콘 자리에 선다. */
export function useToaster() {
  const add = useRegionStore((s) => s.add)
  return useCallback(
    (content: ReactNode, variant: ToastVariant = 'normal', emoji?: EmojiName) => {
      const name = emoji ?? (variant === 'negative' ? 'oops' : undefined)
      add({ type: 'toast', content, variant, icon: name ? <Emoji name={name} size={24} /> : undefined })
    },
    [add],
  )
}

/** 위 막대: 제목 + (뒤로) + (받은편지함 · 설정) */
export function Top({ title, back, actions = false }: { title: ReactNode; back?: string; actions?: boolean }) {
  return (
    <div className="top">
      <TopNavigation
        leadingContent={
          back ? (
            <TopNavigationButton aria-label="뒤로" onClick={() => goBack(back)}>
              <IconChevronLeft />
            </TopNavigationButton>
          ) : undefined
        }
        trailingContent={
          actions ? (
            <>
              <TopNavigationButton aria-label="받은편지함" onClick={() => navigate('/inbox')}>
                <IconBell />
              </TopNavigationButton>
              <TopNavigationButton aria-label="설정" onClick={() => navigate('/settings')}>
                <IconSetting />
              </TopNavigationButton>
            </>
          ) : undefined
        }
      >
        {title}
      </TopNavigation>
    </div>
  )
}

export const POS_LABEL: Record<Pos, string> = {
  noun: '명사', verb: '동사', adj: '형용사', adv: '부사', prep: '전치사',
  conj: '접속사', pron: '대명사', num: '수사', phrase: '표현', other: '기타',
}

export const LEVELS: Level[] = ['B1', 'B2', 'C1']
export const LEVEL_HINT = '고른 레벨까지의 단어가 B1 → B2 → C1 순서로 나와요'
// 레벨 칩 색: montage 토큰 안에서 관사(der 파랑·die 빨강·das 초록)·채점 색과 겹치지 않게 cyan → violet → pink
const LEVEL_COLOR: Record<Level, ThemeColorsToken> = {
  B1: 'semantic.foreground.brand.primary',
  B2: 'semantic.foreground.accent.violet',
  C1: 'semantic.foreground.accent.pink',
}
export function LevelBadge({ level }: { level: Level }) {
  return (
    <ContentBadge size="xsmall" variant="solid" color="accent" accentColor={LEVEL_COLOR[level] ?? LEVEL_COLOR.B1} data-level={level}>
      {level}
    </ContentBadge>
  )
}

/** 약한 단어(새로 잊은 4번 이상) 표시 */
export function WeakBadge() {
  return (
    <ContentBadge size="xsmall" variant="outlined" color="accent" accentColor="semantic.foreground.negative.primary">
      약한 단어
    </ContentBadge>
  )
}

/** 관사(색) + 단어 */
export function Lemma({ word, className = '' }: { word: Pick<Word, 'lemma' | 'pos' | 'gender'>; className?: string }) {
  const a = article(word)
  return (
    <span className={'lemma ' + className} lang="de">
      {a && <span className={'art ' + a}>{a} </span>}
      {word.lemma}
    </span>
  )
}

/** 그림이 있으면 그림, 없거나 못 받으면 머리글자 칸 */
export function WordImage({ word, className = '' }: { word: Word; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (word.image && !broken)
    return <img className={'wimg ' + className} src={imgSrc(word.id)} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
  return (
    <div className={'wimg letter ' + className} aria-hidden>
      {word.lemma.replace(/^sich\s+/, '').charAt(0).toUpperCase()}
    </div>
  )
}

/** 예문 속 단어를 굵게 — 아침 알림 빈칸과 같은 찾기 규칙(shared/cloze.ts). hit = 예문 속 낱말(분리동사는 두 조각 다 굵게) */
export function Example({ de, lemma, hit }: { de: string; lemma: string; hit?: string | null }) {
  const spans = findAll(de, lemma, hit)
  if (!spans.length) return <>{de}</>
  const out: ReactNode[] = []
  let at = 0
  spans.forEach(([s, e], k) => {
    out.push(de.slice(at, s), <b key={k}>{de.slice(s, e)}</b>)
    at = e
  })
  out.push(de.slice(at))
  return <>{out}</>
}

/** 숫자 − n + (montage 에 숫자 증감 부품이 없어 직접 만든다) */
export function Stepper(props: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string }) {
  const { value, min, max, step = 1, onChange, label } = props
  return (
    <div className="stepper" role="group" aria-label={label}>
      <IconButton variant="outlined" size="small" aria-label={`${label} 줄이기`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
        <IconMinus />
      </IconButton>
      <output className="num" aria-live="polite">{value}</output>
      <IconButton variant="outlined" size="small" aria-label={`${label} 늘리기`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
        <IconPlus />
      </IconButton>
    </div>
  )
}

/** 0 → n 으로 굴러가는 숫자(number-flow 를 흉내 낸 짧은 판) */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const from = useRef(0)
  useEffect(() => {
    const c = animate(from.current, value, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = Math.round(v).toLocaleString('ko-KR')
      },
    })
    from.current = value
    return () => c.stop()
  }, [value])
  return <span ref={ref} className="num">0</span>
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <Emoji name="oops" size={120} />
      <p>{error}</p>
      {onRetry && (
        <Button variant="outlined" color="assistive" size="small" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  )
}
