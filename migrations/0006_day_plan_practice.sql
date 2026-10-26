-- Wortling 0006: 오늘 몫(하루 한 번 정하는 새 단어 목록) · 연습 결과
-- 기획 v8(2026-10-26) F1·F5 · 과제 4. 복습 일정(cards)은 연습 결과로 안 바뀐다.

-- 학습일(04:00 KST 경계)마다 한 줄. 아침 알림(또는 그날 처음 연 앱)이 만들고, 그날은 학습 순서가 바뀌어도 그대로
CREATE TABLE day_plans (
  day TEXT PRIMARY KEY,                    -- YYYY-MM-DD 학습일
  fresh TEXT NOT NULL,                     -- 그날 새 단어 id JSON 배열(정한 순서)
  extra INTEGER NOT NULL DEFAULT 0,        -- 「새 단어 더 받기」로 더한 수
  created_at TEXT NOT NULL
);

-- 더 공부하기(예문 빈칸 · 단어 짚기 · 뜻 고르기 …) 결과. 「틀린 단어」 범위와 기록에 쓴다
CREATE TABLE practice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,                      -- cloze pick meaning meaning_rev
  word_id TEXT NOT NULL REFERENCES words(id),
  correct INTEGER NOT NULL,                -- 1 맞힘 · 0 틀림
  at TEXT NOT NULL                         -- ISO
);
CREATE INDEX practice_word_at ON practice(word_id, at);
CREATE INDEX practice_at ON practice(at);
