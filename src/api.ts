// fetch 감싸기 + 접속 키. VITE_MOCK=1 이면 src/mock.ts 가 대신 답한다.
import type {
  ChangesResponse,
  DeckListResponse,
  DrillScope,
  InboxResponse,
  PracticeResponse,
  PracticeResultsRequest,
  PracticeScope,
  ReportRequest,
  ReviewsRequest,
  ReviewsResponse,
  Settings,
  StatsResponse,
  TodayResponse,
  WordDetailResponse,
  WordRequestsResponse,
  WordsQuery,
  WordsResponse,
} from '../shared/api.ts'
import { serverErrorText } from './errors.ts'

export const MOCK = import.meta.env.VITE_MOCK === '1'
const TOKEN_KEY = 'wortling.token'
const UNSENT_KEY = 'wortling.unsent'

export class ApiError extends Error {
  status: number
  /** Worker 가 준 {error} 값(예: bad_webhook_url) */
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// localStorage 는 막혀 있을 수 있다(사생활 모드 등) → 조용히 빈 값
function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function save(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key)
    else localStorage.setItem(key, v)
  } catch {
    /* 저장 못 해도 화면은 돈다 */
  }
}

export const getToken = () => load(TOKEN_KEY) ?? ''
export const setToken = (t: string) => save(TOKEN_KEY, t.trim() || null)

/** 주소의 ?k=… 또는 #/today?k=… 를 저장하고 주소에서 지운다 */
export function takeTokenFromUrl() {
  const search = new URLSearchParams(location.search)
  const [hashPath, hashQuery = ''] = location.hash.replace(/^#/, '').split('?')
  const hq = new URLSearchParams(hashQuery)
  const k = search.get('k') ?? hq.get('k')
  if (!k) return
  setToken(k)
  search.delete('k')
  hq.delete('k')
  const s = search.toString()
  const h = hashPath ? '#' + hashPath + (hq.toString() ? '?' + hq.toString() : '') : ''
  history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + h)
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
  if (MOCK) return (await import('./mock.ts')).mockHandle(method, path, body) as Promise<T>
  const res = await fetch(path, {
    method,
    keepalive,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    onUnauthorized?.()
    throw new ApiError(401, '접속 키가 없거나 틀렸어요')
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, serverErrorText(res.status, j?.error), j?.error)
  }
  return res.json() as Promise<T>
}

function qs(q: Record<string, string | number | undefined>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v))
  return p.toString()
}

/** POST /api/test-notification 응답(Worker 가 정한 모양, shared 계약 밖). 채널별 결과는 건너뛴 경우(skipped) 없다 */
export interface TestNotificationResponse {
  ok: boolean
  status?: number | string
  error?: string
  discord?: { ok: boolean; error?: string }
  /** sent = 알림이 간 기기 수, error = no_subscription · no_vapid · 응답 사유 */
  push?: { ok: boolean; sent: number; failed: number; gone: number; error?: string }
}

/** GET /api/webhook · PUT /api/webhook (주소 자체는 돌려주지 않는다) */
export interface WebhookStatus {
  set: boolean
  source: 'secret' | 'app' | null
}
export interface WebhookSaveResponse {
  ok: boolean
  status: string // sent · failed · skipped · secret_in_use
  error?: string
}

// 채점 전송이 끝나기 전에 오늘 덱을 다시 받으면 방금 채점한 카드가 또 나온다 → 전송을 기다린다
let inflight: Promise<unknown> = Promise.resolve()

// 앱을 열 때 오늘 덱을 설정과 동시에 미리 받아 둔다(왕복 한 번 ≈ 0.4초 줄임 — 한국 접속이 미국 LA 를 거침).
// 오늘 화면이 곧 열리면 그대로 쓰고, 15초가 지나면 버린다(다른 화면을 보다 돌아오면 새로 받음).
let todayPrefetch: { at: number; p: Promise<TodayResponse> } | null = null
export function prefetchToday() {
  const p = inflight.then(() => request<TodayResponse>('GET', '/api/today'))
  p.catch(() => undefined) // 안 쓰고 버려도 처리 안 된 실패로 남지 않게
  todayPrefetch = { at: Date.now(), p }
}

export const api = {
  today: () => {
    const pre = todayPrefetch
    todayPrefetch = null
    if (pre && Date.now() - pre.at < 15_000) return pre.p
    return inflight.then(() => request<TodayResponse>('GET', '/api/today'))
  },
  /** 「새 단어 5개 더 받기」(D3) → 바뀐 오늘 몫 */
  todayMore: () => {
    todayPrefetch = null
    return inflight.then(() => request<TodayResponse>('POST', '/api/today/more'))
  },
  /** 더 공부하기 재료(배운 카드 + 보기 재료) */
  practice: (scope: PracticeScope, n: number) => request<PracticeResponse>('GET', '/api/practice?' + qs({ scope, n })),
  /** 연습 결과(일정은 안 바뀜) */
  savePractice: (body: PracticeResultsRequest) => request<{ ok: boolean; count: number }>('POST', '/api/practice', body),
  words: (q: WordsQuery) => request<WordsResponse>('GET', '/api/words?' + qs({ ...q })),
  word: (id: string) => request<WordDetailResponse>('GET', `/api/word/${encodeURIComponent(id)}`),
  /** 추가 연습 묶음(B4) — 일정은 안 바뀐다 */
  drill: (scope: DrillScope, n: number) => request<DeckListResponse>('GET', '/api/drill?' + qs({ scope, n })),
  /** 관사 1분(B5) */
  artikel: (n: number) => request<DeckListResponse>('GET', '/api/artikel?' + qs({ n })),
  stats: () => inflight.then(() => request<StatsResponse>('GET', '/api/stats')),
  inbox: () => request<InboxResponse>('GET', '/api/inbox'),
  /** 알림 링크(?n=)로 열었을 때 한 번(A4) */
  markOpened: (n: number) => request<{ ok: boolean }>('POST', `/api/notifications/${n}/open`),
  settings: () => request<Settings>('GET', '/api/settings'),
  saveSettings: (patch: Partial<Settings>) => {
    todayPrefetch = null // 하루 새 단어·레벨이 바뀌면 미리 받은 덱은 옛 설정 기준
    return request<Settings>('PUT', '/api/settings', patch)
  },
  testNotification: () => request<TestNotificationResponse>('POST', '/api/test-notification'),
  webhook: () => request<WebhookStatus>('GET', '/api/webhook'),
  saveWebhook: (url: string) => request<WebhookSaveResponse>('PUT', '/api/webhook', { url }),
  pushKey: () => request<{ publicKey: string }>('GET', '/api/push/key'),
  pushSubscribe: (sub: PushSubscriptionJSON) => request<{ ok: boolean; count: number }>('POST', '/api/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => request<{ ok: boolean; count: number }>('DELETE', '/api/push/subscribe', { endpoint }),
  /** 「이상해요」 → 다음 검토 때 먼저 */
  report: (id: string, body: ReportRequest) => request<{ ok: boolean }>('POST', `/api/words/${encodeURIComponent(id)}/report`, body),
  requests: () => request<WordRequestsResponse>('GET', '/api/requests'),
  addRequest: (text: string, url?: string) =>
    request<{ ok: boolean; id: number; duplicate: boolean }>('POST', '/api/requests', { text, ...(url ? { url } : {}) }),
  /** 100개씩, before(번호)를 주면 그보다 앞의 것 */
  changes: (before?: number) => request<ChangesResponse>('GET', '/api/changes' + (before ? `?before=${before}` : '')),
  revertChange: (id: number) => request<{ ok: boolean }>('POST', `/api/changes/${id}/revert`),
}

// ── 채점 전송: 먼저 기기에 적어 두고 보낸 뒤 지운다. 탭이 닫혀도 다음에 열 때 다시 보낸다(서버는 같은 채점을 건너뜀). ──
interface Unsent {
  id: string
  req: ReviewsRequest
}
const readUnsent = (): Unsent[] => {
  try {
    return JSON.parse(load(UNSENT_KEY) ?? '[]') as Unsent[]
  } catch {
    return []
  }
}
const writeUnsent = (list: Unsent[]) => save(UNSENT_KEY, list.length ? JSON.stringify(list) : null)

export function sendReviews(req: ReviewsRequest, keepalive = false): Promise<ReviewsResponse> {
  const id = `${req.session_id}:${req.reviews[0]?.reviewed_at}:${req.reviews.length}`
  writeUnsent([...readUnsent().filter((u) => u.id !== id), { id, req }])
  const p = request<ReviewsResponse>('POST', '/api/reviews', req, keepalive).then((r) => {
    writeUnsent(readUnsent().filter((u) => u.id !== id))
    return r
  })
  inflight = inflight.then(() => p).catch(() => undefined)
  return p
}

/** 앱을 열 때 지난번에 못 보낸 채점을 보낸다. 보낸 개수를 돌려준다. */
// 묶음이 여럿이면 둘째부터는 await 뒤에 보내져 그 사이 오늘 덱 요청이 먼저 나갈 수 있었다 → 다시 보내기 전체를 inflight 에 건다
export function retryUnsent(): Promise<number> {
  const run = (async () => {
    let sent = 0
    for (const u of readUnsent()) {
      try {
        await sendReviews(u.req)
        sent += u.req.reviews.length
      } catch {
        break // 아직 안 됨 → 다음에
      }
    }
    return sent
  })()
  inflight = inflight.then(() => run).catch(() => undefined)
  return run
}

// 목업 그림: public/mascot 에 있는 파일만 쓴다(없는 그림 404 = 콘솔 오류)
const MOCK_IMG: Record<string, string> = { w002: 'umzug', w003: 'verspaetung', w004: 'entscheidung', w005: 'vertrag' }
/** 그림을 다시 그리면 올린다 → 폰에 남은 예전 그림 대신 새 주소로 받는다.
 *  3 부터는 서버 캐시가 하루라 매일 조금씩 다시 그려도 올릴 필요 없음(2 까지 받은 그림은 1년 캐시라 한 번 올림) */
export const IMG_VERSION = 3
export const imgSrc = (id: string) =>
  (MOCK ? `/mascot/${MOCK_IMG[id] ?? '_default'}.webp` : `/img/${id}.webp`) + `?v=${IMG_VERSION}`

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message === 'Failed to fetch' ? '서버에 닿지 않아요. 연결을 확인해 주세요.' : e.message
  return '알 수 없는 오류'
}
