// 보르티 그림체 — 카드 그림(daily.mjs)과 이모티콘(make-emoji.mjs)이 같이 쓴다.
// 기획안 v7 C1 규격(2026-10-14): 카카오 이모티콘 「곰식이」 그림체를 보고 숫자로 고정.
//   선 = 검정, 중간 굵기, 살짝 떨림(굵은 매직펜 아님) · 면 = 흰 몸통 + 포인트 색 최대 3 · 그림자·그러데이션·광택 없음
//   짜임 = 보르티가 화면 높이 절반쯤, 소품 최대 2, 배경 장소 없음(바닥 선 한 줄까지) · 바탕 흰색 · 글자 0
// 프롬프트에 작가·캐릭터 이름을 넣지 않는다(그림체만 따르고 캐릭터는 따라 그리지 않음, C 「지켜야 할 선」).
// 그 전은 3D 클레이. 바꾸면 .data/restyle.json 에 예전 그림 id 를 넣어 매일 작업이 다시 그리게 한다.
export const STYLE_INTRO = 'Cute simple hand-drawn doodle, like a Korean messenger emoticon sticker.';
export const BORTI =
  'Borti: chubby white dachshund puppy, long round blob body, droopy light-brown ears, black dot eyes, small black nose, ' +
  'pink blush cheeks, stubby legs, short curled tail.';
export const STYLE =
  'Medium-thin slightly wobbly black pen outlines, flat fills, no shading, no gradients, no shine. ' +
  'Mostly white with at most three pastel accents (butter yellow, baby pink, sky blue, mint). ' +
  'Pure white background, no room or landscape, just one short ground line; small characters with lots of empty space. ' +
  'No text, letters, numbers, logos or speech bubbles.';
