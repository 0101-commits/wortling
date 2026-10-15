// 「단어 넣기」: 기사에서 만난 단어(활용형도 됨) + 링크 → 다음 새벽 작업이 카드로 만들어 맨 앞에. 최근 넣은 10개 상태.
import { useEffect, useState } from 'react'
import { Button, ContentBadge, TextField } from '@montage-ui/core'
import type { RequestStatus, WordRequestItem } from '../shared/api.ts'
import { REQ_TEXT } from '../shared/request.ts'
import { api, errorText } from './api.ts'
import { linkTo } from './router.ts'
import { useToaster } from './ui.tsx'

const STATUS: Record<RequestStatus, string> = { queued: '내일 아침 전', added: '카드 만듦', exists: '이미 있음 · 앞으로', rejected: '제외' }

export function AddWord({ initialWord = '', initialUrl = '', initialOpen = false }: { initialWord?: string; initialUrl?: string; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const [word, setWord] = useState(initialWord)
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState(false)
  const [list, setList] = useState<WordRequestItem[] | null>(null)
  const toast = useToaster()
  const load = () => api.requests().then((r) => setList(r.items), () => setList([]))
  useEffect(() => {
    if (open && list === null) load()
  }, [open, list])
  const w = word.trim()
  const ok = REQ_TEXT.test(w)
  const send = async () => {
    setBusy(true)
    try {
      const r = await api.addRequest(w, url.trim())
      toast(r.duplicate ? '이미 넣어 둔 단어예요.' : '넣었어요. 내일 아침 전에 카드로 만들어요.', 'positive')
      setWord('')
      setUrl('')
      load()
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(false)
    }
  }
  if (!open)
    return (
      <Button size="small" variant="outlined" color="primary" onClick={() => setOpen(true)}>
        단어 넣기
      </Button>
    )
  return (
    <section className="box wh addword" aria-label="단어 넣기">
      <b>기사에서 만난 단어 넣기</b>
      <TextField placeholder="예: Ermittlung · ermittelte" aria-label="넣을 단어" lang="de" value={word} status={w && !ok ? 'negative' : 'normal'} onChange={(e) => setWord(e.target.value)} />
      <TextField type="url" inputMode="url" placeholder="기사 링크(선택)" aria-label="기사 링크" value={url} onChange={(e) => setUrl(e.target.value)} />
      {w && !ok && <p className="small muted">글자로 된 단어 하나(60자 이내)만 넣어 주세요.</p>}
      <Button fullWidth loading={busy} disabled={!ok} onClick={send}>
        넣기
      </Button>
      {list && list.length > 0 && (
        <ul className="reqs">
          {list.map((r) => (
            <li key={r.id} className="kv">
              {r.word_id ? <a {...linkTo('/word/' + r.word_id)} lang="de">{r.lemma ?? r.text}</a> : <span lang="de">{r.text}</span>}
              <ContentBadge size="xsmall" variant="outlined" color="neutral">{r.status === 'exists' && r.learned ? '이미 배우는 단어' : STATUS[r.status]}</ContentBadge>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
