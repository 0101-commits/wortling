-- Wortling 0003: 알림 누름 버튼(1시간 뒤)·열림 기록.
-- action_key = 알림마다 만드는 무작위 열쇠. 서비스 워커는 접속 키가 없어서, 이 열쇠로 「1시간 뒤」·「열어 봄」을 보낸다.
ALTER TABLE notifications ADD COLUMN action_key TEXT;
ALTER TABLE notifications ADD COLUMN opened_at TEXT;
