# worty (Wortling) — AI 작업 규칙

## 배포
- 배포는 항상 `npm run deploy` 하나로 한다(빌드 → Worker → Pages 전달기 → 점검, `scripts/deploy.mjs`).
- `wrangler pages deploy dist` 금지 — Pages 는 `pages/` 에서만 올린다(전달기 `pages/public/_worker.js` 가 없으면 `/api/*` 가 index.html 을 200 으로 돌려준다).
- Worker 를 화면(`dist`) 없이 올리지 않는다(`/` 가 404). 손으로 `wrangler deploy` 하려면 먼저 `npm run build`.
- 배포 뒤 확인은 `npm run verify`(두 주소 · 상태와 내용 종류 점검). 매일 작업(words · daily)도 시작할 때 같은 점검을 한다.
