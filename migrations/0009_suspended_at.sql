-- Wortling 0009: 쉬기 시작한 시각(약한 단어 L6) — 30일 뒤 저절로 깨우는 기준
-- 8번 잊어 쉬는 카드는 suspended_at 에 시각을 적고, worker/deck.ts wakeSuspended 가 30일 지난 카드를 깨운다.
-- 이미 쉬는 카드는 마지막 채점 시각(없으면 오늘)을 쉬기 시작한 때로 본다. 이 파일은 wrangler 가 한 번만 적용한다.
ALTER TABLE cards ADD COLUMN suspended_at TEXT;
UPDATE cards SET suspended_at = coalesce(last_review, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE suspended = 1 AND suspended_at IS NULL;
