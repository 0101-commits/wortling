// 더 공부하기 문제 화면(기획 v8 과제 4): #/practice?mode=cloze|pick|meaning|meaning_rev&scope=today|week|all|wrong&n=10
// 한 문제씩 → 맞힘/틀림 표시 → 다음. 끝나면 결과를 practice 표에 보내고(일정은 안 바뀜) 틀린 단어만 다시 할 수 있다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Skeleton } from '@montage-ui/core'
import type { DeckItem, PoolWord, PracticeMode, PracticeScope } from '../../shared/api.ts'
import { api, errorText } from '../api.ts'
import { MODES, makeQuestions } from '../practice.ts'
import type { ChoiceQ, PickQ, Question } from '../practice.ts'
import { useAsync } from '../hooks.ts'
import { linkTo, navigate, useRoute } from '../router.ts'
import { Emoji, ErrorBox, Example, Lemma, LevelBadge, POS_LABEL, Top, useToaster } from '../ui.tsx'

const MODE_KEYS = Object.keys(MODES) as PracticeMode[]
const SCOPES: PracticeScope[] = ['today', 'week', 'all', 'wrong']
const SCOPE_EMPTY: Record<PracticeScope, string> = {
  today: '오늘 본 단어가 아직 없어요. 오늘 몫을 먼저 하거나 범위를 넓혀 보세요.',
  week: '최근 7일에 본 단어가 없어요.',
  all: '아직 배운 단어가 없어요.',
  wrong: '틀린 단어가 없어요. 다 맞혔거나 아직 연습 전이에요.',
}

export default function Practice() {
  const q = useRoute().query
  const mode = MODE_KEYS.find((m) => m === q.get('mode')) ?? 'cloze'
  const scope = SCOPES.find((s) => s === q.get('scope')) ?? 'today'
  const n = [10, 20, 30].includes(Number(q.get('n'))) ? Number(q.get('n')) : 10
  const [round, setRound] = useState(0)
  const r = useAsync(() => api.practice(scope, n), [scope, n, round])
  return (
    <>
      <Top title={MODES[mode].title} back="/today" />
      <main className="page practice-page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !r.data || r.loading ? (
          <Skeleton variant="rectangle" width="100%" height={360} radius={20} />
        ) : (
          <Round key={`${mode}:${scope}:${n}:${round}`} mode={mode} items={r.data.items} pool={r.data.pool} n={n} scope={scope} onAgain={() => setRound((k) => k + 1)} />
        )}
      </main>
    </>
  )
}

interface Result {
  word_id: string
  correct: boolean
  at: string
}

function Round(props: { mode: PracticeMode; items: DeckItem[]; pool: PoolWord[]; n: number; scope: PracticeScope; onAgain: () => void }) {
  const { mode, pool, n, scope, onAgain } = props
  const toast = useToaster()
  // 「틀린 단어만 다시」는 같은 재료에서 틀린 카드만으로 새 판
  const [items, setItems] = useState(props.items)
  const [pass, setPass] = useState(0)
  const questions = useMemo(() => makeQuestions(mode, items, pool, n), [mode, items, pool, n, pass])
  const [i, setI] = useState(0)
  const [results, setResults] = useState<Result[]>([])

  const finished = i >= questions.length
  // 결과 보내기: 판이 끝날 때 + 중간에 앱을 내리거나 나갈 때(그때까지 푼 것만, 검토 반영). 실패해도 화면은 그대로 — 기록만 빠짐
  const latest = useRef<Result[]>([])
  const sent = useRef(0)
  useEffect(() => {
    latest.current = results
  }, [results])
  const flush = useCallback(
    (keepalive: boolean) => {
      const rs = latest.current.slice(sent.current)
      if (!rs.length) return
      sent.current = latest.current.length
      api.savePractice({ mode, results: rs }, keepalive).catch((e) => {
        if (!keepalive) toast(`결과를 못 적었어요 · ${errorText(e)}`, 'cautionary')
      })
    },
    [mode, toast],
  )
  useEffect(() => {
    if (finished) flush(false)
  }, [finished, flush])
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush(true)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flush(true)
    }
  }, [flush])

  const answer = useCallback((correct: boolean, id: string) => {
    setResults((rs) => [...rs, { word_id: id, correct, at: new Date().toISOString() }])
  }, [])

  if (questions.length === 0)
    return (
      <section className="empty">
        <Emoji name="think" size={140} />
        <h2>문제를 만들 단어가 없어요</h2>
        <p>{SCOPE_EMPTY[scope]}</p>
        <Button variant="outlined" color="assistive" onClick={() => navigate('/today')}>
          오늘 화면으로
        </Button>
      </section>
    )

  if (finished) {
    const right = results.filter((x) => x.correct).length
    const wrongIds = new Set(results.filter((x) => !x.correct).map((x) => x.word_id))
    const wrong = questions.filter((qq) => wrongIds.has(qq.item.word.id)).map((qq) => qq.item)
    return (
      <section className="done practice-done">
        <div className="ring big" style={{ ['--p' as string]: Math.round((right / results.length) * 100) }} role="img" aria-label={`${results.length}문제 중 ${right}개 맞힘`}>
          <span className="num">
            {right}
            <small>/{results.length}</small>
          </span>
        </div>
        <h1 className="center">
          {results.length}문제 중 {right}개
        </h1>
        {wrong.length > 0 ? (
          <div className="box wh">
            <p className="small muted">틀린 단어 {wrong.length} · 「틀린 단어」 범위에 모았어요</p>
            {wrong.map((it) => (
              <a key={it.word.id} className="kv" {...linkTo('/word/' + it.word.id)}>
                <Lemma word={it.word} />
                <span className="small muted">{it.word.gloss_ko}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="tomorrow center">하나도 안 틀렸어요</p>
        )}
        {wrong.length > 0 && (
          <Button
            fullWidth
            size="large"
            onClick={() => {
              setItems(wrong)
              setPass((p) => p + 1)
              setI(0)
              setResults([])
              latest.current = []
              sent.current = 0
            }}
          >
            틀린 단어만 다시
          </Button>
        )}
        <Button fullWidth size="large" variant={wrong.length ? 'outlined' : 'solid'} color={wrong.length ? 'assistive' : 'primary'} onClick={onAgain}>
          한 판 더
        </Button>
        <Button fullWidth size="large" variant="outlined" color="assistive" onClick={() => navigate('/today')}>
          오늘 화면으로
        </Button>
      </section>
    )
  }

  const qq = questions[i]
  return (
    <>
      <div className="tophint">
        <span className="mix">{MODES[mode].desc}</span>
        <span className="counter num" data-testid="progress" aria-live="polite">
          {i + 1} / {questions.length}
        </span>
      </div>
      <div className="pbar" aria-hidden>
        <i style={{ width: `${(i / questions.length) * 100}%` }} />
      </div>
      {qq.mode === 'pick' ? (
        <PickView key={i} q={qq} onAnswer={answer} onNext={() => setI((k) => k + 1)} />
      ) : (
        <ChoiceView key={i} q={qq} onAnswer={answer} onNext={() => setI((k) => k + 1)} />
      )}
    </>
  )
}

type ViewProps<Q extends Question> = { q: Q; onAnswer: (correct: boolean, id: string) => void; onNext: () => void }

/** 답한 뒤 다음 단추 + Enter */
function NextButton({ onNext }: { onNext: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNext])
  return (
    <Button fullWidth size="large" onClick={onNext} autoFocus>
      다음
    </Button>
  )
}

/** 답한 뒤 보이는 뜻 줄 */
function Gloss({ item, form }: { item: DeckItem; form?: string }) {
  const w = item.word
  return (
    <div className="pgloss">
      <p>
        <Lemma word={w} /> <span>{w.gloss_ko}</span>
      </p>
      {form && form.toLowerCase() !== w.lemma.replace(/^sich\s+/i, '').toLowerCase() && (
        <p className="small muted">
          예문 속 꼴 <span lang="de">{form}</span>
        </p>
      )}
    </div>
  )
}

function ChoiceView({ q, onAnswer, onNext }: ViewProps<ChoiceQ>) {
  const [picked, setPicked] = useState<string | null>(null)
  const w = q.item.word
  const pick = (id: string) => {
    if (picked) return
    setPicked(id)
    onAnswer(id === w.id, w.id)
  }
  // 키보드 1 2 3 4
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/⌘+숫자 = 브라우저 탭 바꾸기 — 보기로 먹지 않게
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = Number(e.key)
      if (k >= 1 && k <= q.choices.length) pick(q.choices[k - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const state = (id: string) => (!picked ? '' : id === w.id ? ' ok' : id === picked ? ' ng' : ' off')
  return (
    <>
      <div className="pcard">
        {q.mode === 'cloze' && q.cloze ? (
          <>
            <p className="pde" lang="de">
              {q.cloze.before}
              {picked ? <mark className="hit">{q.cloze.hit}</mark> : <span className="blank" role="img" aria-label="빈칸" />}
              {q.cloze.after}
            </p>
            <p className="small muted">{w.example_ko}</p>
          </>
        ) : q.mode === 'meaning' ? (
          <>
            <p className="pword">
              <Lemma word={w} />
            </p>
            <p className="small muted">
              {POS_LABEL[w.pos]} <LevelBadge level={w.level} />
            </p>
          </>
        ) : (
          <>
            <p className="pword ko">{w.gloss_ko}</p>
            <p className="small muted">{POS_LABEL[w.pos]}</p>
          </>
        )}
      </div>
      <div className={'popts' + (q.mode === 'cloze' || q.mode === 'meaning_rev' ? ' two' : '')} role="group" aria-label="보기">
        {q.choices.map((c, k) => (
          <button
            key={c.id}
            type="button"
            className={'popt' + state(c.id)}
            lang={q.mode === 'meaning' ? undefined : 'de'}
            aria-keyshortcuts={String(k + 1)}
            disabled={!!picked}
            onClick={() => pick(c.id)}
          >
            {c.text}
            {picked && c.id === w.id && <span className="sr-only"> · 정답</span>}
            {picked && c.id === picked && c.id !== w.id && <span className="sr-only"> · 고른 답, 오답</span>}
          </button>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {picked ? (picked === w.id ? '맞았어요' : `틀렸어요. 정답은 ${q.choices.find((c) => c.id === w.id)?.text ?? w.lemma}`) : ''}
      </p>
      {picked && (
        <>
          {q.mode === 'cloze' ? (
            <Gloss item={q.item} form={q.cloze?.hit} />
          ) : (
            <div className="pgloss">
              <p>
                <Lemma word={w} /> <span>{w.gloss_ko}</span>
              </p>
              {w.example_de && (
                <p className="small" lang="de">
                  <Example de={w.example_de} lemma={w.lemma} />
                </p>
              )}
              {w.example_ko && <p className="small muted">{w.example_ko}</p>}
            </div>
          )}
          <NextButton onNext={onNext} />
        </>
      )}
      {!picked && <p className="small muted center keys">키보드 1 2 3 4 · 다음 Enter</p>}
    </>
  )
}

function PickView({ q, onAnswer, onNext }: ViewProps<PickQ>) {
  const [tapped, setTapped] = useState<number | null>(null)
  const w = q.item.word
  const done = tapped !== null
  const tap = (k: number) => {
    if (done) return
    setTapped(k)
    onAnswer(q.tokens[k].hit, w.id)
  }
  const cls = (k: number) => {
    if (!done) return ''
    if (q.tokens[k].hit) return ' ok'
    return k === tapped ? ' ng' : ''
  }
  return (
    <>
      <div className="pcard">
        <p className="pprompt">
          ‘{w.gloss_ko}’에 해당하는 낱말을 누르세요
        </p>
        <div className="ptokens" lang="de" role="group" aria-label="예문 낱말">
          {q.tokens.map((t, k) => (
            <button key={k} type="button" className={'ptok' + cls(k)} disabled={done} onClick={() => tap(k)}>
              {t.text}
              {done && t.hit && <span className="sr-only"> · 정답</span>}
              {done && k === tapped && !t.hit && <span className="sr-only"> · 고른 낱말, 오답</span>}
            </button>
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {done ? (q.tokens[tapped!].hit ? '맞았어요' : `틀렸어요. 정답은 ${q.tokens.filter((t) => t.hit).map((t) => t.text).join(' ')}`) : ''}
        </p>
        {done && <p className="small muted">{w.example_ko}</p>}
      </div>
      {done && (
        <>
          <Gloss item={q.item} form={q.tokens.filter((t) => t.hit).map((t) => t.text.replace(/[.,!?;:»«„“"]+$/u, '')).join(' ')} />
          <NextButton onNext={onNext} />
        </>
      )}
    </>
  )
}

