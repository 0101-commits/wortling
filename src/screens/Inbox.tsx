// 받은편지함 = 디스코드로 보낸 통의 사본(최근 30통)
import { Button, ContentBadge, Skeleton } from '@montage-ui/core'
import type { InboxItem } from '../../shared/api.ts'
import { api } from '../api.ts'
import { fmtDate } from '../format.ts'
import { useAsync } from '../hooks.ts'
import { navigate } from '../router.ts'
import { ErrorBox, Top } from '../ui.tsx'

const KIND: Record<InboxItem['kind'], string> = { morning: '아침', evening: '저녁', test: '시험' }

/** 앱 주소(#/…)면 앱 안에서, 아니면 새 창으로 */
function open(link: string) {
  const u = new URL(link, location.href)
  if (u.origin === location.origin && u.hash.startsWith('#/')) navigate(u.hash.slice(1))
  else window.open(u.href, '_blank', 'noopener')
}

export default function Inbox() {
  const r = useAsync(() => api.inbox(), [])
  return (
    <>
      <Top title="받은편지함" back="/today" />
      <main className="page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !r.data ? (
          [0, 1, 2].map((i) => <Skeleton key={i} variant="rectangle" width="100%" height={110} radius={16} />)
        ) : r.data.items.length === 0 ? (
          <div className="empty">
            <img src="/mascot/_default.webp" alt="" width={160} height={120} />
            <h2>아직 보낸 통이 없어요</h2>
            <p>아침 07:30 · 저녁 21:00 에 보낸 디스코드 통이 여기에도 남아요.</p>
          </div>
        ) : (
          <>
            {r.data.items.map((it) => (
              <article key={it.id} className={'inbox' + (it.status === 'failed' ? ' failed' : '')}>
                {it.image && <img className="im" src={it.image} alt="" loading="lazy" />}
                <div className="tx">
                  <div className="tt">
                    <b>{it.title || '(제목 없음)'}</b>
                    {it.status === 'failed' && <ContentBadge size="xsmall" variant="solid" color="accent" accentColor="semantic.foreground.negative.primary">실패</ContentBadge>}
                    {it.status === 'queued' && <ContentBadge size="xsmall" variant="outlined" color="neutral">대기</ContentBadge>}
                  </div>
                  {it.body && <p className="bd">{it.body}</p>}
                  <time className="small muted" dateTime={it.sent_at ?? it.day}>
                    {KIND[it.kind]} · {it.sent_at ? fmtDate(it.sent_at) : it.day}
                  </time>
                </div>
                {it.link && (
                  <div className="go">
                    <Button variant="outlined" color="assistive" size="small" fullWidth onClick={() => open(it.link!)}>
                      카드 열기
                    </Button>
                  </div>
                )}
              </article>
            ))}
            <p className="small muted center">디스코드로 보낸 통의 사본 · 최근 30통</p>
          </>
        )}
      </main>
    </>
  )
}
