// VITE_MOCK=1 일 때 Worker 대신 답하는 고정 자료. 게이트(scripts/gates/ui.mjs)와 Worker 없는 로컬 개발용.
import type {
  Card,
  DeckItem,
  InboxItem,
  Rating,
  ReviewsRequest,
  Settings,
  StatsResponse,
  TodayResponse,
  Word,
  WordsResponse,
} from '../shared/api.ts'

const DAY = 86_400_000
const now = () => new Date()
const iso = (d: Date) => d.toISOString()
const ago = (days: number) => iso(new Date(Date.now() - days * DAY))
const later = (days: number) => iso(new Date(Date.now() + days * DAY))

type Seed = [
  lemma: string,
  pos: Word['pos'],
  gender: string | null,
  plural: string | null,
  ipa: string,
  ko: string,
  en: string,
  de: string,
  deKo: string,
  level: Word['level'],
]
const SEED: Seed[] = [
  ['Bewerbung', 'noun', 'die', 'Bewerbungen', '[bəˈvɛʁbʊŋ]', '지원(서)', 'application', 'Ich habe meine Bewerbung gestern abgeschickt.', '어제 지원서를 보냈어요.', 'B1'],
  ['Umzug', 'noun', 'der', 'Umzüge', '[ˈʊmtsuːk]', '이사', 'move, relocation', 'Der Umzug nach Hamburg war anstrengend.', '함부르크로의 이사는 힘들었어요.', 'B1'],
  ['Verspätung', 'noun', 'die', 'Verspätungen', '[fɛɐ̯ˈʃpɛːtʊŋ]', '연착, 지각', 'delay', 'Der Zug hat zwanzig Minuten Verspätung.', '기차가 20분 연착이에요.', 'B1'],
  ['Entscheidung', 'noun', 'die', 'Entscheidungen', '[ɛntˈʃaɪ̯dʊŋ]', '결정', 'decision', 'Das war keine leichte Entscheidung.', '쉬운 결정이 아니었어요.', 'B1'],
  ['Vertrag', 'noun', 'der', 'Verträge', '[fɛɐ̯ˈtʁaːk]', '계약(서)', 'contract', 'Hast du den Vertrag schon unterschrieben?', '계약서에 벌써 서명했어?', 'B1'],
  ['Umwelt', 'noun', 'die', null, '[ˈʊmvɛlt]', '환경', 'environment', 'Wir müssen die Umwelt schützen.', '우리는 환경을 지켜야 해요.', 'B1'],
  ['Gewohnheit', 'noun', 'die', 'Gewohnheiten', '[ɡəˈvoːnhaɪ̯t]', '습관', 'habit', 'Kaffee am Morgen ist eine Gewohnheit.', '아침 커피는 습관이에요.', 'B1'],
  ['Gebäude', 'noun', 'das', 'Gebäude', '[ɡəˈbɔʏ̯də]', '건물', 'building', 'Das Gebäude wurde 1920 gebaut.', '그 건물은 1920년에 지어졌어요.', 'B1'],
  ['Erfahrung', 'noun', 'die', 'Erfahrungen', '[ɛɐ̯ˈfaːʁʊŋ]', '경험', 'experience', 'Sie hat viel Erfahrung in diesem Bereich.', '그녀는 이 분야에 경험이 많아요.', 'B1'],
  ['verschieben', 'verb', null, null, '[fɛɐ̯ˈʃiːbn̩]', '미루다, 옮기다', 'to postpone', 'Können wir den Termin verschieben?', '약속을 미룰 수 있을까요?', 'B1'],
  ['sich beschweren', 'verb', null, null, '[bəˈʃveːʁən]', '불평하다', 'to complain', 'Er hat sich über das Essen beschwert.', '그는 음식에 대해 불평했어요.', 'B1'],
  ['zuverlässig', 'adj', null, null, '[ˈtsuːfɛɐ̯lɛsɪç]', '믿을 만한', 'reliable', 'Sie ist eine zuverlässige Kollegin.', '그녀는 믿을 만한 동료예요.', 'B1'],
  ['allerdings', 'adv', null, null, '[ˈalɐdɪŋs]', '하지만, 물론', 'however', 'Das stimmt, allerdings nur zum Teil.', '맞아요, 하지만 부분적으로만요.', 'B1'],
  ['Voraussetzung', 'noun', 'die', 'Voraussetzungen', '[foˈʁaʊ̯szɛt͡sʊŋ]', '전제 조건', 'prerequisite', 'Deutschkenntnisse sind Voraussetzung.', '독일어 능력이 전제 조건이에요.', 'B2'],
  ['Auseinandersetzung', 'noun', 'die', 'Auseinandersetzungen', '[aʊ̯sʔaɪ̯ˈnandɐzɛt͡sʊŋ]', '논쟁, 대립', 'dispute', 'Es kam zu einer heftigen Auseinandersetzung.', '격렬한 논쟁이 벌어졌어요.', 'B2'],
  ['nachvollziehen', 'verb', null, null, '[ˈnaːxfɔlt͡siːən]', '이해하다, 따라가다', 'to comprehend', 'Ich kann deine Entscheidung nachvollziehen.', '네 결정을 이해할 수 있어.', 'B2'],
  ['Nachhaltigkeit', 'noun', 'die', null, '[ˈnaːxhaltɪçkaɪ̯t]', '지속 가능성', 'sustainability', 'Nachhaltigkeit spielt eine große Rolle.', '지속 가능성이 큰 역할을 해요.', 'B2'],
  ['gelegentlich', 'adj', null, null, '[ɡəˈleːɡn̩tlɪç]', '가끔의', 'occasional', 'Wir treffen uns gelegentlich.', '우리는 가끔 만나요.', 'B2'],
  ['Herausforderung', 'noun', 'die', 'Herausforderungen', '[hɛˈʁaʊ̯sfɔʁdəʁʊŋ]', '도전, 과제', 'challenge', 'Das Projekt ist eine große Herausforderung.', '그 프로젝트는 큰 도전이에요.', 'B2'],
  ['Rücksicht', 'noun', 'die', null, '[ˈʁʏkzɪçt]', '배려', 'consideration', 'Bitte nimm Rücksicht auf die Nachbarn.', '이웃을 배려해 주세요.', 'B1'],
  ['Ausbildung', 'noun', 'die', 'Ausbildungen', '[ˈaʊ̯sbɪldʊŋ]', '직업 교육', 'vocational training', 'Er macht eine Ausbildung zum Koch.', '그는 요리사 직업 교육을 받고 있어요.', 'B1'],
  ['Unterlagen', 'noun', 'die', null, '[ˈʊntɐlaːɡn̩]', '서류', 'documents', 'Bitte bringen Sie alle Unterlagen mit.', '서류를 모두 가져오세요.', 'B1'],
  ['beantragen', 'verb', null, null, '[bəˈʔantʁaːɡn̩]', '신청하다', 'to apply for', 'Ich habe ein Visum beantragt.', '비자를 신청했어요.', 'B1'],
  ['Mitteilung', 'noun', 'die', 'Mitteilungen', '[ˈmɪttaɪ̯lʊŋ]', '통지, 알림', 'notice', 'Haben Sie die Mitteilung bekommen?', '통지를 받으셨나요?', 'B1'],
]

const words: Word[] = SEED.map(([lemma, pos, gender, plural, ipa, ko, en, de, deKo, level], i) => ({
  id: `w${String(i + 1).padStart(3, '0')}`,
  lemma,
  pos,
  gender,
  plural,
  ipa,
  level,
  gloss_en: en,
  gloss_ko: ko,
  example_de: de,
  example_ko: deKo,
  image: i >= 1 && i <= 4, // public/mascot 에 있는 4장만(api.ts imgSrc). 없는 그림은 404 콘솔 오류
  seq: i + 1,
}))

// 상태 섞기: 앞 8개 복습(오늘 만기), 다음 4개 학습 중, 나머지 새 단어
const cards: Card[] = words.map((w, i) => {
  const base: Card = {
    word_id: w.id,
    state: 0,
    due: later(0),
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    last_review: null,
    introduced_at: null,
    suspended: 0,
  }
  if (i < 8) return { ...base, state: 2, due: ago(0.2), stability: 6 + i * 5, difficulty: 5, scheduled_days: 6 + i * 5, reps: 4 + i, lapses: i % 3, last_review: ago(6 + i * 5), introduced_at: ago(40) }
  if (i < 12) return { ...base, state: 1, due: ago(0.1), stability: 1.2, difficulty: 6, learning_steps: 1, reps: 1, last_review: ago(0.5), introduced_at: ago(1) }
  if (i < 14) return { ...base, state: 2, due: later(3), stability: 44, difficulty: 4, scheduled_days: 44, reps: 9, last_review: ago(41), introduced_at: ago(120) }
  return base
})

let settings: Settings = { new_per_day: 5, session_max: 30, level: 'B1', vacation_until: '', swipe_mode: 4, onboarded: true }

let webhook: { set: boolean; source: 'secret' | 'app' | null } = { set: false, source: null }

const inbox: InboxItem[] = [
  { id: 3, kind: 'morning', day: ago(0).slice(0, 10), sent_at: ago(0.3), status: 'sent', title: '오늘 카드 5 · 10/13', body: 'die Bewerbung 지원서 · der Umzug 이사 · die Verspätung 연착\ndie Entscheidung 결정 · der Vertrag 계약', image: '/mascot/umzug.webp', link: '#/today' },
  { id: 2, kind: 'evening', day: ago(1).slice(0, 10), sent_at: ago(0.6), status: 'failed', title: '카드 4장 남았어요', body: '약 2분이면 끝나요.', image: null, link: '#/today' },
  { id: 1, kind: 'morning', day: ago(1).slice(0, 10), sent_at: ago(1.3), status: 'sent', title: '오늘 카드 5 · 10/12', body: 'die Umwelt 환경 · die Gewohnheit 습관 · das Gebäude 건물\ndie Erfahrung 경험 · verschieben 미루다', image: null, link: '#/today' },
]

const reviewsLog: Record<string, Array<{ id: number; rating: Rating; reviewed_at: string; scheduled_days: number }>> = {
  w004: [
    { id: 11, rating: 3, reviewed_at: ago(11), scheduled_days: 11 },
    { id: 7, rating: 3, reviewed_at: ago(16), scheduled_days: 5 },
    { id: 3, rating: 1, reviewed_at: ago(18), scheduled_days: 0 },
  ],
}

const item = (w: Word): DeckItem => ({ word: w, card: cards.find((c) => c.word_id === w.id)! })

const norm = (s: string) => s.toLowerCase().replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü').replace(/ss/g, 'ß')

function wordsList(q: URLSearchParams): WordsResponse {
  const text = norm(q.get('q') ?? '')
  const level = q.get('level') ?? 'all'
  const state = q.get('state') ?? 'all'
  const page = Number(q.get('page') ?? 1)
  const size = Number(q.get('size') ?? 30)
  const all = words
    .map(item)
    .filter((it) => level === 'all' || it.word.level === level)
    .filter((it) => {
      if (state === 'all') return true
      if (state === 'new') return it.card.state === 0
      if (state === 'learning') return it.card.state === 1 || it.card.state === 3
      if (state === 'review') return it.card.state === 2
      return it.card.state === 2 && it.card.stability >= 30
    })
    .filter((it) => !text || norm(it.word.lemma).includes(text) || (it.word.gloss_ko ?? '').includes(text))
  return { total: all.length, page, size, items: all.slice((page - 1) * size, page * size) }
}

function stats(): StatsResponse {
  const heat: StatsResponse['heat'] = []
  for (let i = 83; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY)
    const count = i % 7 === 3 ? 0 : 4 + ((i * 7) % 15)
    heat.push({ day: d.toISOString().slice(0, 10), count })
  }
  return {
    total_words: 1842,
    by_level: { B1: 1120, B2: 722 },
    by_state: { new: 1230, learning: 318, review: 276, relearning: 18 },
    images: 412,
    heat,
    streak_days: 12,
    due_tomorrow: 10,
  }
}

function today(): TodayResponse {
  const t = Date.now()
  const due = words.map(item).filter((it) => it.card.state > 0 && new Date(it.card.due).getTime() <= t)
  const fresh = words.map(item).filter((it) => it.card.state === 0).slice(0, settings.new_per_day)
  return { date: new Date(t + 9 * 3_600_000).toISOString().slice(0, 10), due, fresh, new_done_today: 0, reviewed_today: 3, settings }
}

function applyReviews(body: ReviewsRequest) {
  const touched: Card[] = []
  for (const r of body.reviews) {
    const c = cards.find((x) => x.word_id === r.word_id)
    if (!c) continue
    const days = r.rating === 1 ? 0 : r.rating === 2 ? 1 : r.rating === 3 ? 3 : 8
    Object.assign(c, { state: r.rating === 1 ? 3 : 2, due: later(days || 0.01), reps: c.reps + 1, lapses: c.lapses + (r.rating === 1 ? 1 : 0), last_review: r.reviewed_at, scheduled_days: days })
    if (!touched.includes(c)) touched.push(c)
  }
  return { applied: body.reviews.length, cards: touched }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function mockHandle(method: string, path: string, body?: unknown): Promise<unknown> {
  await wait(120)
  const url = new URL(path, 'http://mock')
  const p = url.pathname
  if (p === '/api/today') return today()
  if (p === '/api/reviews' && method === 'POST') return applyReviews(body as ReviewsRequest)
  if (p === '/api/words') return wordsList(url.searchParams)
  if (p.startsWith('/api/word/')) {
    const w = words.find((x) => x.id === decodeURIComponent(p.slice('/api/word/'.length)))
    if (!w) throw new Error('없는 단어')
    return { ...item(w), reviews: reviewsLog[w.id] ?? [] }
  }
  if (p === '/api/stats') return stats()
  if (p === '/api/inbox') return { items: inbox }
  if (p === '/api/webhook' && method === 'GET') return webhook
  if (p === '/api/webhook' && method === 'PUT') {
    webhook = { set: true, source: 'app' }
    return { ok: true, status: 'sent' }
  }
  if (p === '/api/settings' && method === 'GET') return settings
  if (p === '/api/settings' && method === 'PUT') {
    settings = { ...settings, ...(body as Partial<Settings>) }
    return settings
  }
  if (p === '/api/test-notification' && method === 'POST') {
    inbox.unshift({ id: inbox.length + 1, kind: 'test', day: iso(now()).slice(0, 10), sent_at: iso(now()), status: 'sent', title: '시험 통', body: 'Wortling 과 디스코드가 연결됐어요.', image: null, link: null })
    return { ok: true, status: 'sent', discord: { ok: true }, push: { ok: false, sent: 0, failed: 0, gone: 0, error: 'no_subscription' } }
  }
  throw new Error(`mock: ${method} ${path}`)
}
