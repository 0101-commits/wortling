// Worker ↔ 앱이 함께 쓰는 자료 모양. 키를 바꾸면 양쪽 빌드가 깨진다(G2).

export type Level = 'B1' | 'B2';
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
}

/** GET /api/today */
export interface TodayResponse {
  date: string; // YYYY-MM-DD KST
  due: DeckItem[];
  fresh: DeckItem[];
  new_done_today: number;
  reviewed_today: number;
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
  page?: number;
  size?: number;
}
export interface WordsResponse {
  total: number;
  page: number;
  size: number;
  items: DeckItem[];
}

/** GET /api/word/:id */
export interface WordDetailResponse extends DeckItem {
  reviews: Array<{ id: number; rating: Rating; reviewed_at: string; scheduled_days: number }>;
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
  kind: 'morning' | 'evening' | 'test';
  day: string;
  sent_at: string | null;
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
export interface AdminWordsRequest {
  items: Array<{
    id: string;
    gloss_ko?: string;
    example_de?: string;
    example_ko?: string;
    scene_en?: string;
    gloss_status?: 'generated' | 'checked' | 'mine';
    example_src?: string;
  }>;
}
