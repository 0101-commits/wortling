-- Wortling 0010: D1 행 읽기를 줄이는 색인 + 하루 읽기 합계표(2026-10-30 무료 한도 5M 소진 사고)
-- 안 켜졌어도 Worker 는 돈다(worker/budget.ts 가 표 없음 오류를 삼킨다) — 배포 순서가 앱을 죽이지 않게.

-- 상태별 세기(통계) · 목록의 state 거르기가 cards 전체를 훑지 않게
CREATE INDEX IF NOT EXISTS cards_state ON cards(state);
-- 등급별 세기 · 목록의 level 거르기
CREATE INDEX IF NOT EXISTS words_level ON words(level);
-- 오늘 그릴 그림(runway need_image): 그림 없는 단어만
CREATE INDEX IF NOT EXISTS words_image_none ON words(seq) WHERE image_status = 'none';
-- 오늘 채울 글(runway need_text): 글이 빈 단어만(식이 질의와 글자까지 같아야 색인이 쓰인다)
CREATE INDEX IF NOT EXISTS words_text_gap ON words(seq) WHERE gloss_ko IS NULL OR example_de IS NULL OR scene_en IS NULL;

-- UTC 하루 D1 읽기 합계(worker/budget.ts). 요청마다 한 번 n 을 더한다
CREATE TABLE IF NOT EXISTS read_budget (
  day TEXT PRIMARY KEY,   -- UTC 날짜 YYYY-MM-DD (D1 무료 한도가 UTC 0시에 초기화)
  n INTEGER NOT NULL DEFAULT 0
);
