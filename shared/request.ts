// 「단어 넣기」 글 규칙 — 서버(worker/words.ts) · 앱(src/share.ts · AddWord) · 스크립트(scripts/words/lib.mjs)가 같이 쓴다.
// 글자로 시작, 60자 이내, 글자 · 띄어쓰기 · ' ’ . - 만(주소 · 숫자 · 이모지 안 됨).
// 「tagesschau.de」 처럼 점 앞뒤가 둘 이상 글자인 주소 꼴은 뺀다(「z.B.」·「d.h.」·「z. B.」·「usw.」는 됨)
export const REQ_TEXT = /^(?!.*\p{L}{2,}\.\p{L}{2,})[\p{L}][\p{L}\s'’.-]{0,59}$/u;
