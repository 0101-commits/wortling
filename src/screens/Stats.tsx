// 기록: 벤토 4 · 12주 열기 지도 · 상태 막대 · 레벨 수
import { Skeleton } from '@montage-ui/core'
import type { StatsResponse } from '../../shared/api.ts'
import { api } from '../api.ts'
import { fmtDay, num } from '../format.ts'
import { useAsync } from '../hooks.ts'
import { CountUp, Emoji, ErrorBox, LEVELS, LevelBadge, Top } from '../ui.tsx'

const STATE_ROWS: Array<[keyof StatsResponse['by_state'], string]> = [
  ['new', '새 단어'],
  ['learning', '학습 중'],
  ['review', '복습'],
  ['relearning', '다시 학습'],
]

export default function Stats() {
  const r = useAsync(() => api.stats(), [])
  const d = r.data
  return (
    <>
      <Top title="기록" actions />
      <main className="page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !d ? (
          <>
            <div className="bento">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rectangle" width="100%" height={84} radius={16} />)}
            </div>
            <Skeleton variant="rectangle" width="100%" height={180} radius={16} />
          </>
        ) : (
          <StatsBody d={d} />
        )}
      </main>
    </>
  )
}

function StatsBody({ d }: { d: StatsResponse }) {
  const todayCount = d.heat.at(-1)?.count ?? 0
  const stateTotal = Object.values(d.by_state).reduce((a, b) => a + b, 0) || 1
  const byLevel = (lv: (typeof LEVELS)[number]) => d.by_level[lv] ?? 0 // 서버가 C1 을 아직 안 주면 0
  const levelMax = Math.max(1, ...LEVELS.map(byLevel))
  return (
    <>
      <div className="bento">
        <div className="b">
          <div className="v"><CountUp value={todayCount} /><small>번</small></div>
          <div className="l">오늘 채점</div>
        </div>
        <div className="b">
          <div className="v"><CountUp value={d.due_tomorrow} /><small>장</small></div>
          <div className="l">내일 예정</div>
        </div>
        <div className={'b' + (d.streak_days >= 3 ? ' party' : '')}>
          <div className="v"><CountUp value={d.streak_days} /><small>일</small></div>
          <div className="l">연속 일수</div>
          {d.streak_days >= 3 && <Emoji name="party" size={48} className="b-emoji" />}
        </div>
        <div className="b">
          <div className="v"><CountUp value={d.images} /><small>/ {num(d.total_words)}</small></div>
          <div className="l">그림 있는 단어</div>
        </div>
      </div>

      <section className="box wh pad">
        <div className="row-h">
          <h3>최근 12주</h3>
          <span className="small muted">{num(d.heat.reduce((a, h) => a + h.count, 0))}번 채점</span>
        </div>
        <Heat heat={d.heat} />
        <div className="legend small muted" aria-hidden>
          적음 <i /> <i className="l1" /> <i className="l2" /> <i className="l3" /> <i className="l4" /> 많음
        </div>
      </section>

      <section className="box wh pad">
        <h3>카드 상태</h3>
        <div className="bars">
          {STATE_ROWS.map(([k, label]) => (
            <div className="bar-row" key={k}>
              <span>{label}</span>
              <div className="bar"><i style={{ width: `${(d.by_state[k] / stateTotal) * 100}%` }} /></div>
              <b className="num">{num(d.by_state[k])}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="box wh pad">
        <h3>레벨</h3>
        <div className="bars">
          {LEVELS.map((lv) => (
            <div className="bar-row" key={lv}>
              <span><LevelBadge level={lv} /></span>
              <div className={'bar lv-' + lv}><i style={{ width: `${(byLevel(lv) / levelMax) * 100}%` }} /></div>
              <b className="num">{num(byLevel(lv))}</b>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

/** 열 = 주(월~일), 칸 = 하루. 색은 그 기간 최댓값 대비 4단계 cyan. 구조는 21st.dev heat-calendar 참고. */
function Heat({ heat }: { heat: StatsResponse['heat'] }) {
  if (!heat.length) return null
  const max = Math.max(1, ...heat.map((h) => h.count))
  const first = new Date(heat[0].day + 'T00:00:00Z').getUTCDay() // 0 = 일요일
  const pad = (first + 6) % 7 // 월요일 시작
  const cols = Math.ceil((pad + heat.length) / 7)
  const level = (c: number) => (c === 0 ? '' : c <= max * 0.25 ? 'l1' : c <= max * 0.5 ? 'l2' : c <= max * 0.75 ? 'l3' : 'l4')
  return (
    <div className="heat" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} role="img" aria-label={`최근 ${heat.length}일 채점 기록`}>
      {Array.from({ length: pad }, (_, i) => <i key={'p' + i} className="pad" />)}
      {heat.map((h) => <i key={h.day} className={level(h.count)} title={`${fmtDay(h.day)} · ${h.count}번`} />)}
    </div>
  )
}
