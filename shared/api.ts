// Worker ↔ 앱이 함께 쓰는 자료 모양. 키를 바꾸면 양쪽 빌드가 깨진다(G2).

export type Level = 'B1' | 'B2' | 'C1';
export type Pos = 'noun' | 'verb' | 'adj' | 'adv' | 'prep' | 'conj' | 'pron' | 'num' | 'phrase' | 'other';
export type Rating = 1 | 2 | 3 | 4; // again hard good easy
/** ts-fsrs State: 0 New · 1 Learning · 2 Review · 3 Relearning */
export type CardState = 0 | 1 | 2 | 3;

export interface Word {
  id: string;
  lemma: string;
  pos: Pos;
  gender: string | null;
  plural: string | null;
  ipa: string | null;
  level: Level;
  gloss_en: string | null;
  gloss_ko: string | null;
  example_de: string | null;
  example_ko: string | null;
  /** 예문 속 표제어 낱말(찾기 규칙으로 못 찾는 꼴만, 'gebe|auf' · '-' = 없음). shared/cloze.ts findWord 의 hit */
  example_hit: string | null;
  /** true 면 /img/{id}.webp 가 있다 */
  image: boolean;
  seq: number;
}

export interface Card {
  word_id: string;
  state: CardState;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  last_review: string | null;
  introduced_at: string | null;
  suspended: 0 | 1;
  /** 쉬기 시작한 시각(8번 잊음). 30일 뒤 저절로 깨운다. 앱은 안 쓴다 */
  suspended_at?: string | null;
}

export interface DeckItem {
  word: Word;
  card: Card;
}

export interface Settings {
  new_per_day: number;
  session_max: number;
  level: Level;
  vacation_until: string;
  swipe_mode: 2 | 4;
  onboarded: boolean;
  /** 저녁 알림 조건: none_today = 오늘(학습일) 한 장도 안 했을 때만 · any_left = 남은 카드가 있으면 */
  evening_mode: 'none_today' | 'any_left';
  /** 저녁 알림을 보낼 남은 카드 최소 수 */
  evening_min: number;
  /** 이 학습일(YYYY-MM-DD)은 복습만 — 새 카드 0. 다음 학습일엔 저절로 꺼진 셈 */
  review_only_day: string;
  /**
   * 디스코드로도 알림. false 면 기기 알림(웹 푸시)이 한 대라도 가면 디스코드는 안 보낸다 — 기기가 없거나 다 실패하면 디스코드로.
   * 「이 기기로 받기」를 켜면 앱이 끈다.
   */
  discord_on: boolean;
}

/** GET /api/today · POST /api/today/more — 오늘 몫(기획 v8 F1): 오늘 학습일이 끝나기 전에 마감되는 복습 + 오늘 정한 새 단어 */
export interface TodayResponse {
  date: string; // YYYY-MM-DD KST 학습일
  /** 오늘 학습일이 끝나는 시각(다음 날 04:00 KST, ISO). 채점 뒤 이보다 앞에 다시 볼 카드는 같은 판 뒤로(F2) */
  day_end: string;
  due: DeckItem[];
  fresh: DeckItem[];
  new_done_today: number;
  reviewed_today: number;
  plan: {
    /** 오늘 몫 전체 = 끝낸 카드 + 남은 카드(due + fresh) */
    total: number;
    /** 오늘 채점해서 오늘 안에는 다시 안 나오는 카드 */
    done: number;
    /** 오늘 목록의 새 단어 수(복습만이면 0) */
    fresh_total: number;
    /** 「새 단어 더 받기」로 더한 수 · 하루 상한 */
    extra: number;
    extra_max: number;
  };
  /** 오늘 채점 수: 좋음·쉬움 / 다시·어려움 */
  ratings: { good: number; again: number };
  settings: Settings;
}

/** POST /api/reviews */
export interface ReviewInput {
  word_id: string;
  rating: Rating;
  reviewed_at: string; // ISO
}
export interface ReviewsRequest {
  session_id: string;
  reviews: ReviewInput[];
}
export interface ReviewsResponse {
  applied: number;
  cards: Card[];
}

/** GET /api/words */
export interface WordsQuery {
  q?: string;
  level?: Level | 'all';
  state?: 'all' | 'new' | 'learning' | 'review' | 'done';
  /** seq = 학습 순서(기본) · learned = 배운 날짜 최근 순(아직 안 배운 단어 빠짐) · alpha = 가나다(sich 뺀 표제어) */
  sort?: 'seq' | 'learned' | 'alpha';
  page?: number;
  size?: number;
  /** 1 = 총수를 안 센다(꽉 찬 쪽이면 total 은 지금까지 본 수). 목록 연습처럼 total 을 안 쓰는 호출용 */
  no_total?: 1;
}

/** GET /api/drill?scope=&n= (B4 추가 연습) · GET /api/artikel?n= (B5 관사 1분). 일정(FSRS)은 안 바꾼다 */
export type DrillScope = 'today' | 'week' | 'all';

/**
 * 더 공부하기(기획 v8 과제 4). 결과는 practice 표에 — 틀린 배운 카드는 「다시」 채점(아직 잘 모르는 단어 → 오늘 몫 복습).
 * match = 짝 맞추기(독일어 ↔ 뜻 5쌍, 2026-10-27 「예문 속 단어 짚기」를 바꿈)
 */
export type PracticeMode = 'cloze' | 'match' | 'meaning' | 'meaning_rev' | 'write';
/** wrong = 연습에서 마지막으로 틀린 단어(최근 30일) */
export type PracticeScope = DrillScope | 'wrong';
/** 보기(오답) 재료 — 배운 단어 위주, 모자라면 안 배운 같은 레벨 단어 */
export type PoolWord = Pick<Word, 'id' | 'lemma' | 'pos' | 'gender' | 'gloss_ko'>;
/** GET /api/practice?scope=&n= */
export interface PracticeResponse {
  items: DeckItem[];
  pool: PoolWord[];
}
/** POST /api/practice */
export interface PracticeResultsRequest {
  mode: PracticeMode;
  results: Array<{ word_id: string; correct: boolean; at: string }>;
}
export interface PracticeSaveResponse {
  ok: true;
  count: number;
  /** 이번에 「아직 잘 모르는 단어」로 바꾼 단어 id(오늘 몫 복습에 다시 나옴) */
  relearn: string[];
}
export interface DeckListResponse {
  items: DeckItem[];
}
export interface WordsResponse {
  total: number;
  page: number;
  size: number;
  items: DeckItem[];
}

/** GET /api/word/:id */
export interface WordDetailResponse extends DeckItem {
  /** 그림 장면(영어 한 줄). 매일 작업이 새 장면을 못 쓰면 이것으로 그린다 */
  scene_en: string | null;
  reviews:Array<{ id: number; rating: Rating; reviewed_at: string; scheduled_days: number }>;
}

/** GET /api/stats */
export interface StatsResponse {
  total_words: number;
  by_level: Record<Level, number>;
  by_state: Record<'new' | 'learning' | 'review' | 'relearning', number>;
  images: number;
  /** 최근 12주, day → 채점 수 */
  heat: Array<{ day: string; count: number }>;
  streak_days: number;
  due_tomorrow: number;
}

/** GET /api/inbox */
export interface InboxItem {
  id: number;
  kind: 'morning' | 'evening' | 'evening_later' | 'test';
  day: string;
  sent_at: string | null;
  /** 알림을 눌러 앱을 연 시각(웹 푸시 누름 · 디스코드 링크 ?n=) */
  opened_at: string | null;
  status: 'queued' | 'sent' | 'failed';
  title: string;
  body: string;
  image: string | null;
  link: string | null;
}
export interface InboxResponse {
  items: InboxItem[];
}

/** 관리(매일 스크립트) */
export interface RunwayResponse {
  need_text: Array<Pick<Word, 'id' | 'lemma' | 'pos' | 'gender' | 'level' | 'gloss_en'>>;
  need_image: Array<Pick<Word, 'id' | 'lemma' | 'pos' | 'gender' | 'level'> & { scene_en: string | null }>;
}
export interface AdminWordChange {
  field: 'gloss_ko' | 'example_de' | 'example_ko' | 'gender' | 'plural' | 'level' | 'note';
  old: string | null;
  new: string | null;
  why?: string;
  /** 1 = 바꿈, 0 = 확인 필요(안 바꿈) */
  applied: 0 | 1;
  source?: 'review' | 'report';
}
export interface AdminWordsRequest {
  items: Array<{
    id: string;
    gloss_ko?: string;
    example_de?: string;
    example_ko?: string;
    /** 예문 속 표제어 낱말(scripts/words/hits.mjs). null = 지움 */
    example_hit?: string | null;
    scene_en?: string;
    gloss_status?: 'generated' | 'checked' | 'mine';
    example_src?: string;
    gender?: string | null;
    plural?: string | null;
    level?: Level;
    news_rank?: number | null;
    /** 검토함 → checked_at = 지금 */
    checked?: boolean;
    /** 뜻이 바뀜 → 그림 다시 그리기(image_status = 'none') */
    image_reset?: boolean;
    /** 이 단어의 열린 신고 닫기 */
    close_reports?: boolean;
    changes?: AdminWordChange[];
  }>;
}
/** GET /api/admin/review-queue 한 줄 */
export interface ReviewQueueItem {
  id: string;
  lemma: string;
  pos: Pos;
  gender: string | null;
  plural: string | null;
  level: Level;
  /** goethe 면 레벨은 자동으로 안 바꾼다(공식 목록) */
  level_src: string;
  gloss_ko: string | null;
  gloss_status: string;
  example_de: string | null;
  example_ko: string | null;
  checked_at: string | null;
  /** 사용자가 되돌린 칸 */
  reverted: string[];
  report: { kind: string; note: string | null } | null;
}
export type ReportKind = 'meaning' | 'example' | 'gender' | 'level' | 'image' | 'other';
export interface ReportRequest {
  kind: ReportKind;
  note?: string;
}
export type RequestStatus = 'queued' | 'added' | 'exists' | 'rejected';
export interface WordRequestItem {
  id: number;
  text: string;
  url: string | null;
  created_at: string;
  status: RequestStatus;
  word_id: string | null;
  /** 카드가 된 단어의 표제어 */
  lemma: string | null;
  note: string | null;
  /** 그 단어를 이미 배우는 중(새 카드 아님) */
  learned: boolean;
}
export interface WordRequestsResponse {
  items: WordRequestItem[];
}
export interface ChangeItem {
  id: number;
  word_id: string;
  lemma: string;
  field: string;
  old: string | null;
  new: string | null;
  why: string | null;
  source: 'review' | 'report';
  applied: 0 | 1;
  reverted_at: string | null;
  at: string;
}
export interface ChangesResponse {
  items: ChangeItem[];
}
export interface ReviewStats {
  total: number;
  checked: number;
  week: { applied: number; flagged: number; news: number; mine: number; requests: number };
}

/** GET /api/admin/pending-review — 그림 확인 화면(AI 검사가 못 정한 그림, 오래된 것 먼저) */
export interface PendingReviewItem {
  id: string;
  at: string | null;
  /** 대기에 든 지 며칠 */
  days: number;
  lemma: string;
  gender: string | null;
  gloss_ko: string | null;
}
export interface PendingReviewResponse {
  items: PendingReviewItem[];
}
