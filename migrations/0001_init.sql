-- Wortling 0001: words · cards · reviews · notifications · settings (기획서 4-1)
CREATE TABLE words (
  id TEXT PRIMARY KEY,                       -- w0001
  lemma TEXT NOT NULL,
  pos TEXT NOT NULL,                         -- noun verb adj adv prep conj pron num phrase other
  gender TEXT,                               -- der die das (noun)
  plural TEXT,
  ipa TEXT,
  level TEXT NOT NULL,                       -- B1 B2
  level_src TEXT NOT NULL,                   -- goethe | wordhoard
  gloss_en TEXT,
  gloss_ko TEXT,
  gloss_status TEXT NOT NULL DEFAULT 'missing',  -- missing generated checked mine
  example_de TEXT,
  example_ko TEXT,
  example_src TEXT,                          -- tatoeba:<id> | gen
  scene_en TEXT,                             -- 그림 장면 한 줄(힉스필드 프롬프트 뒤에 붙음)
  image_id TEXT,                             -- R2 key (w0001.webp)
  image_status TEXT NOT NULL DEFAULT 'none', -- none ok failed
  freq_rank INTEGER,
  seq INTEGER NOT NULL,                      -- 학습 순서(level → freq_rank → lemma)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX words_lemma_pos ON words(lemma, pos);
CREATE INDEX words_seq ON words(seq);

CREATE TABLE cards (
  word_id TEXT PRIMARY KEY REFERENCES words(id),
  state INTEGER NOT NULL DEFAULT 0,          -- ts-fsrs State: 0 New 1 Learning 2 Review 3 Relearning
  due TEXT NOT NULL,                         -- ISO UTC
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_review TEXT,
  introduced_at TEXT,                        -- 첫 채점 시각(하루 새 단어 수 세기)
  suspended INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cards_due ON cards(due);
CREATE INDEX cards_state_due ON cards(state, due);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id TEXT NOT NULL REFERENCES words(id),
  rating INTEGER NOT NULL,                   -- 1 again 2 hard 3 good 4 easy
  reviewed_at TEXT NOT NULL,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  undone INTEGER NOT NULL DEFAULT 0,
  prev_json TEXT                             -- 채점 직전 cards 행(되돌리기용)
);
CREATE INDEX reviews_word_time ON reviews(word_id, reviewed_at);
CREATE INDEX reviews_time ON reviews(reviewed_at);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                        -- morning evening test
  day TEXT NOT NULL,                         -- YYYY-MM-DD KST (test 는 전체 시각)
  scheduled_at TEXT NOT NULL,
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'queued',     -- queued sent failed
  payload_json TEXT NOT NULL,
  discord_message_id TEXT,
  error TEXT
);
CREATE UNIQUE INDEX notifications_kind_day ON notifications(kind, day);
CREATE INDEX notifications_scheduled ON notifications(scheduled_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO settings(key, value) VALUES
  ('new_per_day', '5'),
  ('session_max', '25'),
  ('level', 'B1'),
  ('vacation_until', ''),
  ('swipe_mode', '4'),
  ('onboarded', '0');
