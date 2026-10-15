// 「이상해요」(덱 · 단어 상세): 어디가 이상한지 고르고 한 줄 메모 → 다음 새벽 검토가 맨 먼저 본다
import { useRef, useState } from 'react'
import { Button, Chip, TextField } from '@montage-ui/core'
import type { ReportKind } from '../shared/api.ts'
import { api, errorText } from './api.ts'
import { useToaster } from './ui.tsx'

const KINDS: Array<[ReportKind, string]> = [
  ['meaning', '뜻'],
  ['example', '예문'],
  ['gender', '관사·복수'],
  ['level', '레벨'],
  ['image', '그림'],
  ['other', '기타'],
]

export function ReportButton({ wordId, lemma }: { wordId: string; lemma: string }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const [kind, setKind] = useState<ReportKind>('meaning')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToaster()
  const close = () => dlg.current?.close()
  const send = async () => {
    setBusy(true)
    try {
      await api.report(wordId, { kind, ...(note.trim() ? { note: note.trim() } : {}) })
      close()
      setNote('')
      toast('고마워요. 내일 아침 전에 다시 볼게요.', 'positive')
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" className="revonly" onClick={(e) => { e.stopPropagation(); dlg.current?.showModal() }}>
        이상해요
      </button>
      <dialog ref={dlg} className="report-dlg" aria-label={`${lemma} 이상한 곳 알리기`} onClick={(e) => e.target === dlg.current && close()}>
        <h2>
          <span lang="de">{lemma}</span> 어디가 이상해요?
        </h2>
        <div className="chips wrap" role="group" aria-label="이상한 곳">
          {KINDS.map(([k, l]) => (
            <Chip key={k} size="small" variant="outlined" active={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {l}
            </Chip>
          ))}
        </div>
        <TextField placeholder="한 줄 메모(선택)" aria-label="메모" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="report-act">
          <Button variant="outlined" color="assistive" onClick={close}>닫기</Button>
          <Button loading={busy} onClick={send}>보내기</Button>
        </div>
      </dialog>
    </>
  )
}
