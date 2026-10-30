-- Wortling 0011: 그림 수 세기 색인(ok 만 담음). 2026-10-30 백업은 none 8,288 · ok 150 이라 「ok 아닌 것」 색인은 표 전체가 된다
CREATE INDEX IF NOT EXISTS words_image_ok ON words(seq) WHERE image_status = 'ok';
