// 단어 하나: 그림 · 뜻 · 예문 · 카드 상태 · 최근 채점
import { ContentBadge, Skeleton } from '@montage-ui/core'
import { api } from '../api.ts'
import { RATING_LABEL } from '../deck.ts'
import { STATE_LABEL, dayDiff, fmtDate, fmtDay } from '../format.ts'
import { useAsync } from '../hooks.ts'
import { ReportButton } from '../Report.tsx'
import { Example, ErrorBox, LevelBadge, Lemma, POS_LABEL, Top, WordImage } from '../ui.tsx'

export default function WordDetail({ id }: { id: string }) {
  const r = useAsync(() => api.word(id), [id])
  const d = r.data
  return (
    <>
      <Top title={d ? <Lemma word={d.word} /> : '단어'} back="/words" />
      <main className="page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !d ? (
          <>
            <Skeleton variant="rectangle" width="100%" height={220} radius={20} />
            <Skeleton variant="text" width="50%" height={28} />
            <Skeleton variant="text" width="80%" height={18} />
          </>
        ) : (
          <>
            <article className="wcard">
              <div className="ill">
                <WordImage word={d.word} />
              </div>
              <div className="txt">
                <Lemma word={d.word} className="big" />
                <div className="mn">{d.word.gloss_ko ?? '뜻 준비 중'}</div>
                <div className="dk-meta">
                  <ContentBadge size="xsmall" variant="outlined" color="neutral">{POS_LABEL[d.word.pos] ?? d.word.pos}</ContentBadge>
                  <LevelBadge level={d.word.level} />
                  {d.word.plural && <span lang="de">복수 {d.word.plural}</span>}
                  {d.word.ipa && <span>{d.word.ipa}</span>}
                </div>
                {d.word.example_de && (
                  <p className="dk-ex">
                    <span lang="de">
                      <Example de={d.word.example_de} lemma={d.word.lemma} hit={d.word.example_hit} />
                    </span>
                    {d.word.example_ko && <span className="ko">{d.word.example_ko}</span>}
                  </p>
                )}
              </div>
            </article>
            <div className="report-row">
              <ReportButton wordId={d.word.id} lemma={d.word.lemma} />
            </div>

            <h3 className="sec-t">카드</h3>
            <div className="box">
              <div className="kv"><span>상태</span><b>{STATE_LABEL[d.card.state]}{d.card.suspended ? ' · 멈춤' : ''}</b></div>
              <div className="kv">
                <span>다음 복습</span>
                <b>{d.card.state === 0 ? '아직 안 봄' : dayDiff(d.card.due) <= 0 ? '오늘' : `${fmtDay(d.card.due)} · ${dayDiff(d.card.due)}일 뒤`}</b>
              </div>
              <div className="kv"><span>안정도</span><b>{d.card.state === 0 ? '—' : `${d.card.stability.toFixed(1)}일`}</b></div>
              <div className="kv"><span>본 횟수 · 잊은 횟수</span><b>{d.card.reps} · {d.card.lapses}</b></div>
              <div className="kv"><span>처음 본 날</span><b>{d.card.introduced_at ? fmtDay(d.card.introduced_at) : '—'}</b></div>
            </div>

            <h3 className="sec-t">최근 채점</h3>
            {d.reviews.length === 0 ? (
              <p className="small muted">아직 채점한 적이 없어요.</p>
            ) : (
              <ul className="box revs">
                {d.reviews.map((v) => (
                  <li className="kv" key={v.id}>
                    <span className={'rate r' + v.rating}>{RATING_LABEL[v.rating]}</span>
                    <span className="small">{fmtDate(v.reviewed_at)}</span>
                    <b>{v.scheduled_days > 0 ? `${v.scheduled_days}일 뒤로` : '오늘 다시'}</b>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </>
  )
}
