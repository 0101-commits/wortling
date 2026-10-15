// 고친 카드: 매일 새벽 검토가 바꾼 것(되돌리기) · 확인 필요(근거가 엇갈려 안 바꾼 것)
import { useState } from 'react'
import { Button, Skeleton } from '@montage-ui/core'
import type { ChangeItem } from '../../shared/api.ts'
import { api, errorText } from '../api.ts'
import { fmtDate } from '../format.ts'
import { useAsync } from '../hooks.ts'
import { linkTo } from '../router.ts'
import { Emoji, ErrorBox, Top, useToaster } from '../ui.tsx'

const FIELD: Record<string, string> = { gloss_ko: '뜻', example_de: '예문', example_ko: '예문 번역', gender: '관사', plural: '복수', level: '레벨', note: '메모' }

function Row({ c, onRevert, busy = false }: { c: ChangeItem; onRevert?: () => void; busy?: boolean }) {
  return (
    <li>
      <div className="kv">
        <a {...linkTo('/word/' + c.word_id)} lang="de">
          <b>{c.lemma}</b>
        </a>
        <span className="small muted">{FIELD[c.field] ?? c.field} · {fmtDate(c.at)}</span>
      </div>
      {c.field !== 'note' && (
        <p className="diff">
          <del>{c.old ?? '없음'}</del> → <span>{c.new ?? '없음'}</span>
        </p>
      )}
      {c.why && <p className="small muted">{c.why}</p>}
      {c.applied === 1 &&
        (c.reverted_at ? (
          <span className="small muted">되돌림 · {fmtDate(c.reverted_at)}</span>
        ) : (
          onRevert && (
            <Button size="small" variant="outlined" color="assistive" loading={busy} onClick={onRevert}>
              되돌리기
            </Button>
          )
        ))}
    </li>
  )
}

const PAGE = 100 // 서버가 한 번에 주는 수(worker/index.ts getChanges)

export default function Changes() {
  const r = useAsync(() => api.changes(), [])
  const toast = useToaster()
  const [busy, setBusy] = useState<number | null>(null)
  // 더 보기: 하루 250장 검토면 며칠 만에 100건을 넘는다 → 오래된 고침도 되돌릴 수 있게
  const [more, setMore] = useState<ChangeItem[]>([])
  const [end, setEnd] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const revert = async (c: ChangeItem) => {
    setBusy(c.id)
    try {
      await api.revertChange(c.id)
      toast(`${c.lemma} ${FIELD[c.field] ?? c.field}을 되돌렸어요.`, 'positive')
      setMore([])
      setEnd(false)
      r.reload()
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(null)
    }
  }
  const first = r.data?.items ?? []
  const items = [...first, ...more]
  const canMore = !end && (more.length ? more.length % PAGE === 0 : first.length === PAGE)
  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const res = await api.changes(items[items.length - 1].id)
      setMore((m) => [...m, ...res.items])
      if (res.items.length < PAGE) setEnd(true)
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setLoadingMore(false)
    }
  }
  const flagged = items.filter((c) => !c.applied)
  const applied = items.filter((c) => c.applied)
  return (
    <>
      <Top title="고친 카드" back="/settings" />
      <main className="page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !r.data ? (
          <Skeleton variant="rectangle" width="100%" height={160} radius={16} />
        ) : items.length === 0 ? (
          <div className="empty">
            <Emoji name="study" size={120} />
            <h2>아직 고친 카드가 없어요</h2>
            <p>매일 새벽 카드를 검토해요. 바꾼 게 생기면 여기에 보여요.</p>
          </div>
        ) : (
          <>
            {flagged.length > 0 && (
              <>
                <h3 className="sec-t">확인 필요 · {flagged.length}</h3>
                <ul className="box wh chg">
                  {flagged.map((c) => <Row key={c.id} c={c} />)}
                </ul>
              </>
            )}
            <h3 className="sec-t">고친 것 · {applied.length}</h3>
            <ul className="box wh chg">
              {applied.map((c) => <Row key={c.id} c={c} busy={busy === c.id} onRevert={() => revert(c)} />)}
            </ul>
            {canMore && (
              <Button variant="outlined" color="assistive" fullWidth loading={loadingMore} onClick={loadMore}>
                더 보기
              </Button>
            )}
          </>
        )}
      </main>
    </>
  )
}
