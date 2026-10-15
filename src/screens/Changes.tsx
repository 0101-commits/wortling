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

export default function Changes() {
  const r = useAsync(() => api.changes(), [])
  const toast = useToaster()
  const [busy, setBusy] = useState<number | null>(null)
  const revert = async (c: ChangeItem) => {
    setBusy(c.id)
    try {
      await api.revertChange(c.id)
      toast(`${c.lemma} ${FIELD[c.field] ?? c.field}을 되돌렸어요.`, 'positive')
      r.reload()
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(null)
    }
  }
  const items = r.data?.items ?? []
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
          </>
        )}
      </main>
    </>
  )
}
