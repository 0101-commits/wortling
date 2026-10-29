// 더 공부하기 문제 화면(기획 v8 과제 4): #/practice?mode=cloze|match|meaning|meaning_rev|write&scope=today|week|all|wrong&n=10
// 한 문제씩 → 맞힘/틀림 표시(고른 보기의 뜻도) → 다음. 끝나면 결과를 practice 표에 보내고,
// 틀린 배운 단어는 서버가 「다시」 채점해 오늘 몫 복습에 다시 넣는다. 틀린 단어만 다시 할 수도 있다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Skeleton } from '@montage-ui/core'
import type { DeckItem, PoolWord, PracticeMode, PracticeScope } from '../../shared/api.ts'
import { api, errorText } from '../api.ts'
import { MODES, checkWrite, makeQuestions, withArticle, wordsIn } from '../practice.ts'
import type { Choice, ChoiceQ, MatchQ, Question, WriteQ } from '../practice.ts'
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
  // 예전 「예문 속 단어 짚기」(pick) 주소는 짝 맞추기로
  const mode = q.get('mode') === 'pick' ? 'match' : (MODE_KEYS.find((m) => m === q.get('mode')) ?? 'cloze')
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
  const total = useMemo(() => questions.reduce((s, qq) => s + wordsIn(qq), 0), [questions])
  const [i, setI] = useState(0)
  const [results, setResults] = useState<Result[]>([])
  // 서버가 「아직 잘 모르는 단어」로 바꾼 단어(판 끝 전송의 답). null = 아직 모름 · 전송 실패
  const [relearn, setRelearn] = useState<string[] | null>(null)

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
      api
        .savePractice({ mode, results: rs }, keepalive)
        .then((r) => {
          if (!keepalive) setRelearn((prev) => [...(prev ?? []), ...(r.relearn ?? [])])
        })
        .catch((e) => {
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
        <p>{mode === 'match' && props.items.length > 0 ? '짝 맞추기는 뜻이 서로 다른 단어가 3개 이상 있어야 해요. 범위를 넓혀 보세요.' : SCOPE_EMPTY[scope]}</p>
        <Button variant="outlined" color="assistive" onClick={() => navigate('/today')}>
          오늘 화면으로
        </Button>
      </section>
    )

  if (finished) {
    const right = results.filter((x) => x.correct).length
    const wrongIds = new Set(results.filter((x) => !x.correct).map((x) => x.word_id))
    const all = questions.flatMap((qq) => (qq.mode === 'match' ? qq.items : [qq.item]))
    const wrong = all.filter((it) => wrongIds.has(it.word.id))
    const moved = relearn?.length ?? 0
    return (
      <section className="done practice-done">
        <div className="ring big" style={{ ['--p' as string]: Math.round((right / Math.max(1, results.length)) * 100) }} role="img" aria-label={`${results.length}개 중 ${right}개 맞힘`}>
          <span className="num">
            {right}
            <small>/{results.length}</small>
          </span>
        </div>
        <h1 className="center">
          {results.length}
          {mode === 'match' ? '단어' : '문제'} 중 {right}개
        </h1>
        {wrong.length > 0 ? (
          <div className="box wh">
            <p className="small muted">
              틀린 단어 {wrong.length}
              {/* 0 이면 말 안 함 — 이미 오늘 몫인 단어이거나, 앱을 내리며 보낸 묶음의 답은 못 받는다(검토 반영) */}
              {moved > 0 ? ` · ${moved}개를 「아직 잘 모르는 단어」로 바꿔 오늘 복습에 넣었어요` : ''}
            </p>
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
        {moved > 0 && (
          <Button fullWidth size="large" onClick={() => navigate('/deck')}>
            오늘 복습에서 다시 보기
          </Button>
        )}
        {wrong.length > 0 && (
          <Button
            fullWidth
            size="large"
            variant={moved > 0 ? 'outlined' : 'solid'}
            color={moved > 0 ? 'assistive' : 'primary'}
            onClick={() => {
              setItems(wrong)
              setPass((p) => p + 1)
              setI(0)
              setResults([])
              setRelearn(null)
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
  const before = questions.slice(0, i).reduce((s, x) => s + wordsIn(x), 0)
  return (
    <>
      <div className="tophint">
        <span className="mix">{MODES[mode].desc}</span>
        <span className="counter num" data-testid="progress" aria-live="polite">
          {mode === 'match' ? `${before + wordsIn(qq)} / ${total}` : `${i + 1} / ${questions.length}`}
        </span>
      </div>
      <div className="pbar" aria-hidden>
        <i style={{ width: `${(before / total) * 100}%` }} />
      </div>
      {qq.mode === 'match' ? (
        <MatchView key={`${pass}:${i}`} q={qq} onAnswer={answer} onNext={() => setI((k) => k + 1)} />
      ) : qq.mode === 'write' ? (
        <WriteView key={`${pass}:${i}`} q={qq} onAnswer={answer} onNext={() => setI((k) => k + 1)} />
      ) : (
        <ChoiceView key={`${pass}:${i}`} q={qq} onAnswer={answer} onNext={() => setI((k) => k + 1)} />
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

/** 보기 단어 한 줄: 관사 붙인 독일어 · 품사 · 뜻 */
function WordLine({ w, tag }: { w: PoolWord; tag?: string }) {
  return (
    <p className="pline">
      {tag && <span className="ptag">{tag}</span>}
      <Lemma word={w} /> <span className="small muted">{POS_LABEL[w.pos]}</span> <span>{w.gloss_ko}</span>
    </p>
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
  // 답한 뒤 보기마다 아래에 작게: 뜻 고르기 = 그 뜻의 독일어, 나머지 = 그 단어의 뜻
  const sub = (c: Choice) => (q.mode === 'meaning' ? withArticle(c.word) : c.word.gloss_ko)
  const wrongPick = picked && picked !== w.id ? q.choices.find((c) => c.id === picked) : undefined
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
            {picked && sub(c) && (
              <small className="popt-sub" lang={q.mode === 'meaning' ? 'de' : 'ko'}>
                {sub(c)}
              </small>
            )}
          </button>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {picked ? (picked === w.id ? '맞았어요' : `틀렸어요. 정답은 ${q.choices.find((c) => c.id === w.id)?.text ?? w.lemma}`) : ''}
      </p>
      {picked && (
        <>
          <div className="pgloss">
            <p>
              <Lemma word={w} /> <span>{w.gloss_ko}</span>
            </p>
            {q.mode === 'cloze'
              ? q.cloze &&
                q.cloze.hit.toLowerCase() !== w.lemma.replace(/^sich\s+/i, '').toLowerCase() && (
                  <p className="small muted">
                    예문 속 꼴 <span lang="de">{q.cloze.hit}</span>
                  </p>
                )
              : w.example_de && (
                  <>
                    <p className="small" lang="de">
                      <Example de={w.example_de} lemma={w.lemma} hit={w.example_hit} />
                    </p>
                    {w.example_ko && <p className="small muted">{w.example_ko}</p>}
                  </>
                )}
            {/* 고른 오답 단어 설명(2026-10-27 사용자 지시) */}
            {wrongPick && <WordLine w={wrongPick.word} tag="고른 답" />}
          </div>
          <NextButton onNext={onNext} />
        </>
      )}
      {!picked && <p className="small muted center keys">키보드 1 2 3 4 · 다음 Enter</p>}
    </>
  )
}

/** 독일어 쓰기: 뜻을 보고 직접 입력. 움라우트·ß는 풀어 써도 맞으로(ä→a, ß→ss) */
function WriteView({ q, onAnswer, onNext }: ViewProps<WriteQ>) {
  const [value, setValue] = useState('')
  const [done, setDone] = useState<boolean | null>(null)
  const w = q.item.word
  const check = () => {
    if (done !== null || !value.trim()) return
    const ok = checkWrite(q.item, value)
    setDone(ok)
    onAnswer(ok, w.id)
  }
  return (
    <>
      <div className="pcard">
        <p className="pword ko">{w.gloss_ko}</p>
        <p className="small muted">
          {POS_LABEL[w.pos]} <LevelBadge level={w.level} />
        </p>
      </div>
      <div className="pwrite">
        <input
          type="text"
          lang="de"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="독일어를 입력하세요"
          value={value}
          disabled={done !== null}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (done === null) check()
              else onNext()
            }
          }}
          autoFocus
          aria-label="독일어 입력"
        />
        {done === null ? (
          <Button fullWidth size="large" onClick={check} disabled={!value.trim()}>
            확인
          </Button>
        ) : (
          <>
            <p className={'pverdict' + (done ? ' ok' : ' ng')} aria-live="polite">
              {done ? '맞았어요' : '틀렸어요'}
            </p>
            <div className="pgloss">
              <p>
                <Lemma word={w} /> <span>{w.gloss_ko}</span>
              </p>
              {w.example_de && (
                <>
                  <p className="small" lang="de">
                    <Example de={w.example_de} lemma={w.lemma} hit={w.example_hit} />
                  </p>
                  {w.example_ko && <p className="small muted">{w.example_ko}</p>}
                </>
              )}
            </div>
            <NextButton onNext={onNext} />
          </>
        )}
      </div>
      {done === null && <p className="small muted center keys">Enter 확인</p>}
    </>
  )
}

/**
 * 짝 맞추기: 왼쪽(독일어) 하나 + 오른쪽(뜻) 하나를 차례로 누른다(어느 쪽 먼저든). 맞으면 둘 다 잠기고,
 * 틀리면 잠깐 빨갛게 보였다가 풀린다 — 먼저 누른 쪽 단어를 「틀림」으로 남긴다(그 단어를 찾다가 헷갈린 것).
 * 단어마다 짝을 맞출 때 결과 하나(한 번이라도 틀렸으면 틀림).
 */
function MatchView({ q, onAnswer, onNext }: ViewProps<MatchQ>) {
  const [sel, setSel] = useState<{ side: 'l' | 'r'; id: string } | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [missed, setMissed] = useState<string[]>([])
  const [bad, setBad] = useState<{ l: string; r: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const finished = done.length === q.items.length
  const [said, setSaid] = useState('')

  const tap = (side: 'l' | 'r', c: Choice) => {
    if (done.includes(c.id) || bad) return
    if (!sel || sel.side === side) {
      setSel(sel && sel.side === side && sel.id === c.id ? null : { side, id: c.id })
      return
    }
    const l = side === 'l' ? c.id : sel.id
    const r = side === 'r' ? c.id : sel.id
    if (l === r) {
      setDone((d) => [...d, l])
      onAnswer(!missed.includes(l), l)
      setSaid(`맞았어요. ${q.left.find((x) => x.id === l)?.text} = ${q.right.find((x) => x.id === l)?.text}`)
      setSel(null)
      return
    }
    // 먼저 누른 쪽 단어를 틀림으로(그 단어 짝을 찾던 중)
    setMissed((m) => (m.includes(sel.id) ? m : [...m, sel.id]))
    setBad({ l, r })
    setSaid('짝이 아니에요')
    setSel(null)
    timer.current = setTimeout(() => setBad(null), 650)
  }
  const cls = (side: 'l' | 'r', id: string) =>
    done.includes(id) ? ' ok' : bad && bad[side] === id ? ' ng' : sel && sel.side === side && sel.id === id ? ' sel' : ''
  const col = (side: 'l' | 'r', list: Choice[]) => (
    <div className="pmatch-col" role="group" aria-label={side === 'l' ? '독일어' : '뜻'}>
      {list.map((c) => (
        <button
          key={c.id}
          type="button"
          className={'popt pm' + cls(side, c.id)}
          lang={side === 'l' ? 'de' : undefined}
          aria-pressed={sel?.side === side && sel.id === c.id}
          disabled={done.includes(c.id)}
          onClick={() => tap(side, c)}
        >
          {c.text}
        </button>
      ))}
    </div>
  )
  return (
    <>
      <div className="pmatch">
        {col('l', q.left)}
        {col('r', q.right)}
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      {finished ? (
        <>
          <div className="pgloss">
            {q.items.map((it) => (
              <WordLine key={it.word.id} w={it.word} tag={missed.includes(it.word.id) ? '틀림' : undefined} />
            ))}
          </div>
          <NextButton onNext={onNext} />
        </>
      ) : (
        <p className="small muted center keys">독일어 하나, 뜻 하나를 차례로 누르세요</p>
      )}
    </>
  )
}
