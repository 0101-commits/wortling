-- Wortling 0004: 카드 정기 검토 · 뉴스 단어 · 신고 · 내가 넣은 단어
-- 설계 docs/superpowers/specs/2026-10-15-word-review-news-design.md
ALTER TABLE words ADD COLUMN checked_at TEXT;                         -- 마지막 검토 시각(ISO)
ALTER TABLE words ADD COLUMN news_rank INTEGER;                       -- Leipzig 뉴스 말뭉치 기본형 순위(1 = 가장 자주)
ALTER TABLE words ADD COLUMN news_hits30 INTEGER NOT NULL DEFAULT 0;  -- 최근 30일 tagesschau·NDR 제목·요약에 나온 기사 수
ALTER TABLE words ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;       -- 내가 넣은 단어: 레벨 설정과 상관없이 새 카드 맨 앞

CREATE TABLE word_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id TEXT NOT NULL REFERENCES words(id),
  field TEXT NOT NULL,                     -- gloss_ko example_de example_ko gender plural level note
  old TEXT,
  new TEXT,
  why TEXT,
  source TEXT NOT NULL DEFAULT 'review',   -- review | report
  applied INTEGER NOT NULL DEFAULT 1,      -- 1 = 바꿈, 0 = 확인 필요(안 바꿈)
  reverted_at TEXT,
  at TEXT NOT NULL
);
CREATE INDEX word_changes_at ON word_changes(at);
CREATE INDEX word_changes_word_field ON word_changes(word_id, field);

CREATE TABLE word_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id TEXT NOT NULL REFERENCES words(id),
  kind TEXT NOT NULL,                      -- meaning example gender level image other
  note TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX word_reports_open ON word_reports(closed_at, created_at);

CREATE TABLE word_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,                      -- 사용자가 친 그대로(활용형일 수 있음)
  url TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued added exists rejected
  word_id TEXT,
  note TEXT
);
CREATE INDEX word_requests_status ON word_requests(status, created_at);

CREATE TABLE news_days (
  day TEXT NOT NULL,                       -- YYYY-MM-DD KST
  key TEXT NOT NULL,                       -- 기본형|품사 (sich 뺌, 대소문자 그대로)
  n INTEGER NOT NULL,                      -- 그날 나온 기사 수
  url TEXT,                                -- 그 기본형이 나온 기사 링크 1개(글은 저장 안 함)
  PRIMARY KEY (day, key)
);
CREATE INDEX news_days_key ON news_days(key, day);

CREATE TABLE word_skips (                  -- 새 단어 후보에서 뺀 기본형(Claude keep:false) — 매일 다시 묻지 않게
  key TEXT PRIMARY KEY,
  reason TEXT,
  at TEXT NOT NULL
);
