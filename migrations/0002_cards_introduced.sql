-- Wortling 0002: 오늘 새로 배운 수(introduced_at >= 오늘 0시) 를 색인으로 세기 위해
CREATE INDEX cards_introduced ON cards(introduced_at);
