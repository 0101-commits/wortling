// 오늘 화면(기획 v8 안 A): 오늘 몫 카드 + 더 공부하기. 덱은 #/deck 에서 넘긴다.
// 오늘 몫 = 오늘 학습일(04:00 경계)이 끝나기 전에 마감되는 복습 + 아침에 정한 새 단어 — 다 하면 그날은 더 생기지 않는다.
import { useEffect, useRef, useState } from 'react'
import { Button, SegmentedControl, SegmentedControlItem, Skeleton } from '@montage-ui/core'
import { IconChevronRight } from '@montage-ui/icon'
import type { PracticeMode, Settings, TodayResponse } from '../../shared/api.ts'
import { api, errorText } from '../api.ts'
import { fmtDay } from '../format.ts'
import { useAsync } from '../hooks.ts'
import { MODES } from '../practice.ts'
import { navigate, useRoute } from '../router.ts'
import { CountUp, Emoji, ErrorBox, Top, useToaster } from '../ui.tsx'

/** 더 공부하기 목록. 방식을 늘리면 여기 한 줄(문제 꼴은 practice.ts · Practice.tsx) */
interface Entry {
  key: string
  title: string
  desc: string
  short: string
  kind: 'practice' | 'swipe' | 'artikel'
  mode?: PracticeMode
  /** 「새」 표시 끝나는 날(학습일) */
  newUntil?: string
}
const NEW_UNTIL = '2026-11-09'
const ENTRIES: Entry[] = [
  { key: 'cloze', ...MODES.cloze, kind: 'practice', mode: 'cloze', newUntil: NEW_UNTIL },
  { key: 'match', ...MODES.match, kind: 'practice', mode: 'match', newUntil: '2026-11-10' },
  { key: 'meaning', title: '뜻 고르기', desc: '독일어 → 뜻, 뜻 → 독일어', short: '뜻', kind: 'practice', mode: 'meaning', newUntil: NEW_UNTIL },
  { key: 'artikel', title: '관사 1분', desc: 'der · die · das 빠르게', short: '관사', kind: 'artikel' },
  { key: 'swipe', title: '다시 넘겨 보기', desc: '배운 카드를 넘기며 뜻 확인', short: '넘김', kind: 'swipe' },
]

/** 한 장 ≈ 6초(알림 「약 N분」과 같은 셈 — worker/discord.ts minutesFor) */
const minutesFor = (n: number) => Math.max(1, Math.ceil((n * 6) / 60))

export default function Today({ onSettings }: { onSettings: (p: Partial<Settings>) => Promise<void> }) {
  // 알림의 빈칸 문제 링크(?first=)는 덱으로 바로
  const first = useRoute().query.get('first')
  useEffect(() => {
    if (first) navigate(`/deck?first=${encodeURIComponent(first)}`, true)
  }, [first])
  // 덱으로 바로 갈 거면 여기서 받지 않는다(미리 받은 오늘 몫은 덱이 쓴다)
  const today = useAsync(() => (first ? new Promise<TodayResponse>(() => {}) : api.today()), [])
  const [sheet, setSheet] = useState<Entry | null>(null)
  const d = today.data
  return (
    <>
      <Top title="오늘" actions />
      <main className="page">
        {d ? (
          <PlanCard key={d.date} d={d} onSettings={onSettings} onChanged={today.reload} />
        ) : today.error ? (
          <ErrorBox error={today.error} onRetry={today.reload} />
        ) : (
          <Skeleton variant="rectangle" width="100%" height={196} radius={20} />
        )}
        <section className="more" aria-labelledby="more-h">
          <div className="more-h">
            <h2 id="more-h">더 공부하기</h2>
            <span className="small muted">틀리면 오늘 복습에 다시</span>
          </div>
          <ul className="more-list">
            {ENTRIES.map((e) => (
              <li key={e.key}>
                <button
                  type="button"
                  className="more-row"
                  onClick={() => (e.kind === 'artikel' ? navigate('/artikel') : setSheet(e))}
                >
                  <span className="more-ico" aria-hidden>
                    {e.short}
                  </span>
                  <span className="more-t">
                    <b>
                      {e.title}
                      {e.newUntil && d && d.date <= e.newUntil && <span className="new-badge">새</span>}
                    </b>
                    <span className="small muted">{e.desc}</span>
                  </span>
                  <IconChevronRight className="more-chev" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <StartSheet entry={sheet} studiedToday={(d?.plan.done ?? 0) > 0} onClose={() => setSheet(null)} />
    </>
  )
}

function Ring({ done, total }: { done: number; total: number }) {
  const p = total ? Math.round((done / total) * 100) : 100
  return (
    <div className="ring" style={{ ['--p' as string]: p }} role="img" aria-label={`오늘 몫 ${total}장 중 ${done}장 끝`}>
      <span className="num">
        {done}
        <small>/{total}</small>
      </span>
    </div>
  )
}

function PlanCard({ d, onSettings, onChanged }: { d: TodayResponse; onSettings: (p: Partial<Settings>) => Promise<void>; onChanged: () => void }) {
  const toast = useToaster()
  const [busy, setBusy] = useState(false)
  const left = d.due.length + d.fresh.length
  const { total, done, extra, extra_max } = d.plan
  const reviewOnly = d.settings.review_only_day === d.date
  const away = d.settings.vacation_until && d.settings.vacation_until >= d.date ? d.settings.vacation_until : ''
  const canMore = !reviewOnly && extra < extra_max

  const setReviewOnly = async (on: boolean) => {
    await onSettings({ review_only_day: on ? d.date : '' })
    onChanged()
  }
  const more = async () => {
    setBusy(true)
    try {
      const t = await api.todayMore()
      if (t.plan.extra === extra) toast('더 받을 새 단어가 없어요. 레벨을 올리면 더 나와요.', 'cautionary')
      onChanged()
    } catch (e) {
      toast(`새 단어를 못 받았어요 · ${errorText(e)}`, 'negative')
    } finally {
      setBusy(false)
    }
  }

  // 남은 카드가 있음 → 시작 · 이어서
  if (left > 0) {
    return (
      <section className="plan" aria-label="오늘 몫">
        <div className="plan-top">
          <Ring done={done} total={total} />
          <div className="plan-txt">
            <h1>{done > 0 ? '오늘 몫 · 이어서' : '오늘 몫'}</h1>
            <p className="small">
              {d.due.length > 0 && `복습 ${d.due.length}`}
              {d.due.length > 0 && d.fresh.length > 0 && ' · '}
              {d.fresh.length > 0 && `새 단어 ${d.fresh.length}`} · 약 {minutesFor(left)}분
            </p>
            {away && <p className="small muted">휴가 모드 · {fmtDay(away)}까지 알림을 쉬어요</p>}
          </div>
        </div>
        <Button fullWidth size="large" onClick={() => navigate('/deck')}>
          {done > 0 ? `이어서 ${left}장` : '시작'}
        </Button>
        {done === 0 && (d.fresh.length > 0 || reviewOnly) && (
          <button type="button" className={'revonly' + (reviewOnly ? ' on' : '')} aria-pressed={reviewOnly} onClick={() => setReviewOnly(!reviewOnly)}>
            {reviewOnly ? '복습만 · 끄기' : '오늘은 복습만'}
          </button>
        )}
      </section>
    )
  }

  // 오늘 몫 끝(또는 처음부터 없음) → 결과 · 새 단어 더
  const ended = total > 0
  return (
    <section className="plan" aria-label="오늘 몫">
      <div className="plan-top">
        <Emoji name={ended ? 'happy' : 'sleep'} size={76} />
        <div className="plan-txt">
          <h1>{ended ? '오늘 몫 끝' : '오늘 몫이 없어요'}</h1>
          {ended ? (
            <p className="small">
              {total}장 끝 · <Tomorrow />
            </p>
          ) : (
            <p className="small">{reviewOnly ? '오늘은 복습만 하기로 했고, 복습할 카드가 없어요.' : '복습할 카드도 새 단어도 없어요.'}</p>
          )}
          {away && <p className="small muted">휴가 모드 · {fmtDay(away)}까지 알림을 쉬어요</p>}
        </div>
      </div>
      {ended && (
        <div className="plan-mini">
          <div>
            <b className="num">{d.ratings.good}</b>좋음 · 쉬움
          </div>
          <div>
            <b className="num">{d.ratings.again}</b>다시 · 어려움
          </div>
        </div>
      )}
      {reviewOnly ? (
        <Button fullWidth variant="outlined" color="primary" onClick={() => setReviewOnly(false)}>
          새 단어 오늘 받기
        </Button>
      ) : (
        canMore && (
          <>
            <Button fullWidth variant="outlined" color="primary" loading={busy} onClick={more}>
              새 단어 5개 {ended ? '더 ' : ''}받기
            </Button>
            <p className="small muted center">
              내일부터 복습이 그만큼 늘어요{extra > 0 ? ` · 오늘 ${extra}/${extra_max}개 더 받음` : ''}
            </p>
          </>
        )
      )}
    </section>
  )
}

/** 내일 볼 카드 수(오늘 몫을 끝냈을 때만 부른다) */
function Tomorrow() {
  const st = useAsync(() => api.stats(), [])
  return <>내일 {st.data ? <CountUp value={st.data.due_tomorrow} /> : <span className="num">…</span>}장</>
}

const PRACTICE_SCOPES: Array<[string, string]> = [
  ['today', '오늘 본 단어'],
  ['week', '최근 7일'],
  ['all', '배운 전체'],
  ['wrong', '틀린 단어'],
]

/** 방식 고르면 뜨는 창: 범위 × 분량(뜻 고르기는 방향도) → 시작 */
function StartSheet({ entry, studiedToday, onClose }: { entry: Entry | null; studiedToday: boolean; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const swipe = entry?.kind === 'swipe'
  const [scope, setScope] = useState('today')
  const [n, setN] = useState('10')
  const [dir, setDir] = useState<'meaning' | 'meaning_rev'>('meaning')
  useEffect(() => {
    if (!entry) return
    // 오늘 아직 안 했으면 「최근 7일」부터
    setScope(studiedToday ? 'today' : 'week')
    setN('10')
    if (!dlg.current?.open) dlg.current?.showModal()
  }, [entry, studiedToday])
  const close = () => dlg.current?.close()
  const start = () => {
    if (!entry) return
    const path = swipe
      ? `/drill?scope=${scope}&n=${n}`
      : `/practice?mode=${entry.mode === 'meaning' ? dir : entry.mode}&scope=${scope}&n=${n}`
    close()
    navigate(path)
  }
  const scopes = swipe ? PRACTICE_SCOPES.slice(0, 3) : PRACTICE_SCOPES
  const sizes = swipe ? ['10', '30', '50'] : ['10', '20', '30']
  return (
    <dialog
      ref={dlg}
      className="sheet-dlg"
      aria-label={entry ? `${entry.title} 시작` : '연습 시작'}
      onClick={(e) => e.target === dlg.current && close()}
      onClose={onClose}
    >
      {entry && (
        <div className="sheet-in">
          <h2>{entry.title}</h2>
          <p className="small muted">{entry.desc}</p>
          {entry.mode === 'meaning' && (
            <>
              <p className="sheet-l">방향</p>
              <SegmentedControl size="small" value={dir} onValueChange={(v) => setDir(v as typeof dir)}>
                <SegmentedControlItem value="meaning">독일어 → 뜻</SegmentedControlItem>
                <SegmentedControlItem value="meaning_rev">뜻 → 독일어</SegmentedControlItem>
              </SegmentedControl>
            </>
          )}
          <p className="sheet-l">어떤 단어로</p>
          <div className={'sheet-grid' + (scopes.length === 4 ? ' four' : '')} role="radiogroup" aria-label="범위">
            {scopes.map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={scope === v} className={'pill' + (scope === v ? ' on' : '')} onClick={() => setScope(v)}>
                {l}
              </button>
            ))}
          </div>
          <p className="sheet-l">{swipe ? '몇 장' : entry.mode === 'match' ? '몇 단어' : '몇 문제'}</p>
          <SegmentedControl size="small" value={n} onValueChange={setN}>
            {sizes.map((v) => (
              <SegmentedControlItem key={v} value={v}>
                {v}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <p className="small muted">
            {swipe ? '모르면 줄 뒤로 가요. 복습 일정은 그대로예요.' : '틀린 단어는 「아직 잘 모르는 단어」가 되어 오늘 복습에 다시 나와요.'}
          </p>
          <div className="sheet-act">
            <Button variant="outlined" color="assistive" onClick={close}>
              닫기
            </Button>
            <Button onClick={start}>시작</Button>
          </div>
        </div>
      )}
    </dialog>
  )
}
