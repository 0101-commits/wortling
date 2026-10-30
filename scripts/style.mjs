// 보르티 그림체 — 카드 그림(daily.mjs)과 이모티콘(make-emoji.mjs)이 같이 쓴다.
// 기획안 v7 C1 규격(2026-10-14): 카카오 이모티콘 「곰식이」 그림체를 보고 숫자로 고정.
//   선 = 검정, 중간 굵기, 살짝 떨림(굵은 매직펜 아님) · 면 = 흰 몸통 + 포인트 색 최대 3 · 그림자·그러데이션·광택 없음
//   짜임 = 보르티가 화면 높이 절반쯤, 뜻을 맡은 물건·동작은 크게, 소품 최대 2, 배경 장소 없음(바닥 선 한 줄까지) · 바탕 흰색 · 글자 0
// 프롬프트에 작가·캐릭터 이름을 넣지 않는다(그림체만 따르고 캐릭터는 따라 그리지 않음, C 「지켜야 할 선」).
// 2026-10-14 밤: 장마다 보르티 생김새가 흔들려(물개형·타원형·귀 색) 참고 그림 borti-ref.png(이모티콘 think 에서 뜸)를
// FLUX.2 input_image_0 으로 함께 보낸다. 그림체를 바꾸면 .data/restyle.json 에 예전 그림 id 를 넣어 매일 작업이 다시 그리게 한다.
import { fileURLToPath } from 'node:url';

export const REF_FILE = fileURLToPath(new URL('./borti-ref.png', import.meta.url));
export const STYLE_INTRO = 'Cute simple hand-drawn doodle, like a Korean messenger emoticon sticker.';
export const REF_NOTE =
  'Borti looks exactly like the white puppy in the reference image (same face, tan ears, round body, line style); only his pose and expression change.';
// 2026-10-19 사용자 「강아지 다리가 5개 같은 오류」 → 몸 구조를 숫자로 못 박는다(걸러 내는 건 judge.mjs 몫)
// 2026-10-27 사용자 「다리 3개」 → 앞발 하나가 몸 뒤로 사라진 그림이 많았다: 앞발 둘 · 뒷발 둘이 다 보이게
export const BORTI =
  'Borti: chubby white puppy, round pear-shaped body, floppy tan ears, black dot eyes, small black nose, pink blush cheeks, ' +
  'exactly four stubby legs and one short curled tail; one head; never extra legs, paws or tails. ' +
  'Always draw all four legs clearly visible: two front paws and two hind paws, none hidden behind his body.';
export const STYLE =
  'Medium-thin slightly wobbly black pen outlines, flat fills, no shading, no gradients, no shine. ' +
  'Mostly white with at most three pastel accents (butter yellow, baby pink, sky blue, mint). ' +
  'Pure white background with a white margin, no room or landscape, one short ground line. ' +
  'Borti about half the frame height; the key object or action large and clear. ' +
  'No text, letters or numbers; simple symbols like ? ! hearts or sweat drops are fine.';
// 참고 그림을 못 받는 글자 전용 모델(FLUX.1 schnell, 2026-10-30)용 덧붙임 — 보르티 생김새와 그림체를 글로 한 번 더 못 박는다
export const STYLE_TEXT_ONLY =
  'Flat vector sticker illustration, clean white background. Borti must look like the same mascot in every picture: ' +
  'white fluffy puppy with a round pear-shaped body, two floppy tan ears, two black dot eyes, a small black nose, pink cheeks, a short curled tail. ' +
  'Hand-drawn black pen outline, wobbly and slightly thick, filled with flat pastel colors, korean emoticon sticker look. ' +
  'Wide landscape composition with the subject centered and generous white margins.';
