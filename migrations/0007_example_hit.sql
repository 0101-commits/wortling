-- Wortling 0007: 예문 속 표제어 낱말(기획 v8 W1)
-- 찾기 규칙(shared/cloze.ts findWord)으로 못 찾는 예문만 단어 작업(scripts/words/hits.mjs)이 적는다.
-- 'gebe|auf' = 예문 속 낱말을 | 로 이음(분리동사 두 조각) · '-' = AI 도 못 찾음(다시 안 물음) · NULL = 아직 안 봄 / 규칙으로 찾음
-- 예문(example_de)이 바뀌면 NULL 로 되돌린다(worker/words.ts patchWords · revertChange).
ALTER TABLE words ADD COLUMN example_hit TEXT;
