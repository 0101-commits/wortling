# worty (Wortling) — AI 작업 규칙

## 배포
- 배포는 항상 `npm run deploy` 하나로 한다(빌드 → Worker → Pages 전달기 → 점검, `scripts/deploy.mjs`).
- `wrangler pages deploy dist` 금지 — Pages 는 `pages/` 에서만 올린다(전달기 `pages/public/_worker.js` 가 없으면 `/api/*` 가 index.html 을 200 으로 돌려준다).
- Worker 를 화면(`dist`) 없이 올리지 않는다(`/` 가 404). 손으로 `wrangler deploy` 하려면 먼저 `npm run build`.
- 배포 뒤 확인은 `npm run verify`(두 주소 · 상태와 내용 종류 점검). 매일 작업(words · daily)도 시작할 때 같은 점검을 한다.

## D1 읽기 한도(무료 하루 500만 행, 계정 전체 공용)
- 원격 일괄 SQL 은 `node scripts/db/remote-sql.mjs <파일.sql | --command "..."> `로만 보낸다(로컬 사본에서 먼저 읽기량을 어림해 20만 행을 넘으면 거절). 임시 표 상관 부질의는 색인을 먼저 만든다.
- 분석·검수 스크립트는 원격 대신 최신 백업의 로컬 사본(`scripts/db/local-copy.mjs`)을 읽는다.
