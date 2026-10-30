// 그림 확인: AI 검사가 못 정한 그림을 한 장씩 보고 「좋아요」(공개 그림으로) · 「다시 그리기」(버림 → 매일 작업이 다시 그림)
import { useEffect, useRef, useState } from 'react'
import { Button, Skeleton } from '@montage-ui/core'
import type { PendingReviewItem } from '../../shared/api.ts'
import { ApiError, api, errorText, pendingImageUrl } from '../api.ts'
import { useAsync } from '../hooks.ts'
import { navigate } from '../router.ts'
import { Emoji, ErrorBox, Top, useToaster } from '../ui.tsx'

export default function ImageReview() {
  const r = useAsync(() => api.pendingReview(), [])
  return (
    <>
      <Top title="그림 확인" back="/settings" />
      <main className="page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !r.data ? (
          <Skeleton variant="rectangle" width="100%" height={300} radius={20} />
        ) : (
          <Reviewer first={r.data.items} />
        )}
      </main>
    </>
  )
}

function Reviewer({ first }: { first: PendingReviewItem[] }) {
  const toast = useToaster()
  const total = first.length
  const [items, setItems] = useState(first)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false) // 동기 잠금 — busy 상태는 다음 렌더에야 반영돼 연타가 두 번 결정을 보낸다
  const cur = items[0]
  const [img, setImg] = useState<{ id: string; src?: string; error?: string } | null>(null)

  // 지금 장의 그림을 받는다(토큰 길이라 blob 주소로). 장이 바뀌거나 화면을 떠나면 주소를 돌려준다
  useEffect(() => {
    if (!cur) return
    let live = true
    let url = ''
    pendingImageUrl(cur.id).then(
      (u) => {
        url = u
        if (live) setImg({ id: cur.id, src: u })
        else if (u.startsWith('blob:')) URL.revokeObjectURL(u)
      },
      (e) => live && setImg({ id: cur.id, error: errorText(e) }),
    )
    return () => {
      live = false
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [cur?.id])

  if (!cur)
    return (
      <div className="empty">
        <Emoji name="party" size={120} />
        <p>{total ? '모두 확인했어요' : '확인할 그림이 없어요'}</p>
        <Button variant="outlined" color="assistive" size="small" onClick={() => navigate('/settings', true)}>
          설정으로
        </Button>
      </div>
    )

  const decide = async (ok: boolean) => {
    if (lock.current) return
    lock.current = true
    const id = cur.id // 결정한 장 — 응답 뒤엔 맨 앞 장이 달라졌을 수 있어 id 로 뺀다
    setBusy(true)
    try {
      await (ok ? api.approvePending(id) : api.rejectPending(id))
      toast(ok ? `${cur.lemma} 그림을 올렸어요` : `${cur.lemma} 그림은 다시 그릴게요`, 'positive')
      setItems((l) => l.filter((x) => x.id !== id))
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setItems((l) => l.filter((x) => x.id !== id)) // 그사이 매일 작업이 처리함
      toast(errorText(e), 'negative')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const shown = img?.id === cur.id ? img : null
  const done = total - items.length

  return (
    <>
      <div className="rv-head">
        <span>남은 그림 <b className="num">{items.length}</b>장</span>
        <span className="muted num">{done + 1} / {total}</span>
      </div>
      <div className="rv-prog" aria-hidden>
        <i style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <div className="rv-pic">
        {shown?.src ? <img src={shown.src} alt={`${cur.lemma} 그림`} draggable={false} /> : shown?.error ? <p className="small muted">{shown.error}</p> : <Skeleton variant="rectangle" width="100%" height="100%" radius={20} />}
      </div>
      <div className="rv-word" lang="de">
        {cur.gender ? cur.gender + ' ' : ''}
        <b>{cur.lemma}</b>
        {cur.gloss_ko && <small lang="ko">{cur.gloss_ko}</small>}
      </div>
      <div className="box wh rv-chk">
        <b>보면서 확인할 것</b>
        <span>뜻이 보이나요? · 몸이 이상하거나 글자가 섞이지 않았나요?</span>
        {cur.days >= 3 && <span className="muted">AI 검사: {cur.days}일째 판정 못 함</span>}
      </div>
      <div className="rv-btns">
        <Button fullWidth size="large" variant="outlined" color="assistive" disabled={busy} onClick={() => decide(false)}>
          다시 그리기
        </Button>
        <Button fullWidth size="large" color="primary" loading={busy} disabled={!shown?.src} onClick={() => decide(true)}>
          좋아요
        </Button>
      </div>
    </>
  )
}
