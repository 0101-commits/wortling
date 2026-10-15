-- Wortling 0005: 「180일 지난 검토」 줄 고르기(worker/words.ts reviewQueue)가 매일 단어 전체를 훑지 않게
CREATE INDEX words_checked_at ON words(checked_at);
