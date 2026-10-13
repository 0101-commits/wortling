// 해시 라우터. `#/word/abc?k=1` → { path: '/word/abc', parts: ['word','abc'], query }
import { useSyncExternalStore, type MouseEvent } from 'react'

export interface Route {
  path: string
  parts: string[]
  query: URLSearchParams
}

export function parseHash(hash = location.hash): Route {
  const raw = hash.replace(/^#/, '') || '/today'
  const [p, q = ''] = raw.split('?')
  const path = p.startsWith('/') ? p : '/' + p
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(q) }
}

/** 앱 안 이동은 history.state.inApp 을 남긴다 → 뒤로 버튼이 앱 밖으로 나가지 않는다 */
export function navigate(path: string, replace = false) {
  const url = location.pathname + location.search + '#' + path
  if (replace) history.replaceState(history.state, '', url)
  else history.pushState({ inApp: true }, '', url)
  // pushState·replaceState 는 hashchange 를 내지 않으므로 직접 알린다
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function goBack(fallback: string) {
  if ((history.state as { inApp?: boolean } | null)?.inApp) history.back()
  else navigate(fallback, true)
}

/** <a href="#/…"> 를 누르면 앱 안 이동으로(새 탭 열기는 그대로) */
export function linkTo(path: string) {
  return {
    href: '#' + path,
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
      e.preventDefault()
      navigate(path)
    },
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  window.addEventListener('popstate', cb)
  return () => {
    window.removeEventListener('hashchange', cb)
    window.removeEventListener('popstate', cb)
  }
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash)
  return parseHash(hash)
}
