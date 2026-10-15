// 「단어 넣기」 글 규칙 — 서버(worker/words.ts) · 앱(src/share.ts · AddWord) · 스크립트(scripts/words/lib.mjs)가 같이 쓴다.
// 글자로 시작, 60자 이내, 글자 · 띄어쓰기 · ' ’ . - 만(주소 · 숫자 · 이모지 안 됨)
export const REQ_TEXT = /^[\p{L}][\p{L}\s'’.-]{0,59}$/u;
