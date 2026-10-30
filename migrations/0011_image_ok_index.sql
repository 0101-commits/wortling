-- Wortling 0011: 그림 수 세기 색인. 0010 은 「ok 가 대부분」이라 보고 ok 아닌 것만 색인했지만
-- 2026-10-30 백업은 none 8,288 · ok 150 이라 그 색인이 표 전체(8.4천)였다 → ok 만 담아 세는 쪽이 곧 그림 수
CREATE INDEX IF NOT EXISTS words_image_ok ON words(seq) WHERE image_status = 'ok';
