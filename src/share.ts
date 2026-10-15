// 폰 공유하기(manifest share_target: /?title=&text=&url=) → 단어 화면 「단어 넣기」 칸.
// 공유 글에 주소가 섞여 오면 떼어 링크 칸으로, 남은 글이 단어 꼴이 아니면 단어 칸은 비운다.
import { REQ_TEXT } from '../shared/request.ts'

export function fromShare(q: URLSearchParams): { word: string; url: string } | null {
  const title = q.get('title') ?? ''
  const text = q.get('text') ?? ''
  const link = q.get('url') ?? ''
  if (!title && !text && !link) return null
  const url = link.startsWith('https://') ? link : ((text + ' ' + title).match(/https:\/\/\S+/)?.[0] ?? '')
  const rest = text.replace(/https?:\/\/\S+/g, ' ').trim().replace(/\s+/g, ' ')
  return { word: REQ_TEXT.test(rest) ? rest : '', url }
}

/** 공유로 열렸으면 주소의 ?title·text·url 을 지우고 #/words?add=…&url=… 로 */
export function takeShareFromUrl() {
  const sh = fromShare(new URLSearchParams(location.search))
  if (!sh) return
  const q = new URLSearchParams({ add: sh.word, url: sh.url, open: '1' })
  history.replaceState(null, '', location.pathname + '#/words?' + q.toString())
}
