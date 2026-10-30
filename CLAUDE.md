# worty (Wortling) — AI 작업 규칙

## 배포
- 배포는 항상 `npm run deploy` 하나로 한다(빌드 → Worker → Pages 전달기 → 점검, `scripts/deploy.mjs`).
- `wrangler pages deploy dist` 금지 — Pages 는 `pages/` 에서만 올린다(전달기 `pages/public/_worker.js` 가 없으면 `/api/*` 가 index.html 을 200 으로 돌려준다).
- Worker 를 화면(`dist`) 없이 올리지 않는다(`/` 가 404). 손으로 `wrangler deploy` 하려면 먼저 `npm run build`.
- 배포 뒤 확인은 `npm run verify`(두 주소 · 상태와 내용 종류 점검). 매일 작업(words · daily)도 시작할 때 같은 점검을 한다.

## 앱 DB = Supabase Postgres(2026-10-30~, `docs/supabase-db.md`)
- `wrangler.jsonc` 의 `DB_BACKEND=pg` → Hyperdrive `worty-pg`(캐시 끔) → 스키마 `worty`. D1 `wortling` 은 되돌리기 길로만 남긴다(이 계정 D1 무료 몫은 ai-cli 가 쓴다 — worty 가 D1 을 읽지 않게).
- 표·칸을 바꾸면 `migrations/`(D1)와 `scripts/db/schema.pg.sql` 을 같이 고친다. Worker SQL 은 두 DB 공용 꼴로 쓰고, 다른 곳만 `worker/db.ts` 도우미로 가른다(`npm test` 의 `tests/pg-backend.test.mjs` 가 두 DB 결과를 비교).
- 원격 일괄 SQL 은 `node scripts/db/remote-sql.mjs <파일.sql | --command "..."> `로만 보낸다(pg 면 한 거래, d1 이면 로컬 사본에서 읽기량을 어림해 20만 행을 넘으면 거절).
- 연결 정보는 저장소 밖 `~/.secrets/worty-supabase.env` 에만 둔다(커밋·출력 금지).
- 분석·검수 스크립트는 원격 대신 최신 백업의 로컬 사본(`scripts/db/local-copy.mjs`)을 읽는다.
