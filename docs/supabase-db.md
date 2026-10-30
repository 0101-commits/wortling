# 앱 DB: D1 → Supabase(Postgres) (2026-10-30)

worty 의 D1 읽기가 계정 공용 D1 무료 몫(하루 500만 행)을 다 써 ai-cli 까지 멈췄다. 그래서 DB 자리만 바꿨다 —
worty 는 Supabase Postgres, 이 계정의 D1 몫은 ai-cli 혼자 쓴다. Worker·Pages·KV·AI·알림 시계(DO)는 그대로 Cloudflare.

## 구성

| 무엇 | 값 |
|---|---|
| Supabase 프로젝트 | `azabpxwznskfbnemecte`(서울) — ai-cli 와 같은 프로젝트. ai-cli 표는 `public`, worty 는 스키마 `worty` |
| 역할 | `worty_app`(스키마·표 주인, 검색 경로 `worty`, `public` 표 권한 없음). 표에는 RLS 를 켜고 정책은 없다(REST 로 못 읽음) |
| 연결 정보 | 저장소 밖 `~/.secrets/worty-supabase.env` 의 `WORTY_PG_URL`(세션 풀러 `aws-0-ap-northeast-2.pooler.supabase.com:5432`, 사용자 `worty_app.<ref>`). 직접 연결 주소는 IPv6 전용이라 이 PC 에서 안 된다 |
| Hyperdrive | `worty-pg`(id `15d5ba71556b4135a59fb4bc354782c3`) — **캐시 끔**(쓰고 바로 읽어야 한다) |
| 스위치 | `wrangler.jsonc` vars `DB_BACKEND` = `pg` |
| 어댑터 | `worker/db.ts` — D1 모양(prepare·bind·first·all·run·batch)을 Postgres 위에. SQL 은 두 DB 공용 부분집합, 다른 곳만 도우미(`jsonEach` · `dayOf` · `crossJoin` · `ciLike` · `concatDistinct`) |
| 스키마 | `scripts/db/schema.pg.sql`(migrations 0001~0011 반영, TEXT 는 `COLLATE "C"` = SQLite 정렬과 같게) |

## 고칠 때

- 표·칸을 바꾸면 `migrations/`(D1, 되돌리기 길)와 `scripts/db/schema.pg.sql` 을 같이 고치고 `node scripts/db/d1-to-pg.mjs --schema` 로 적용(몇 번 돌려도 안전 — 새 칸은 `ALTER TABLE … ADD COLUMN IF NOT EXISTS` 를 스키마 끝에 더한다).
- 새 SQL 은 두 방언에서 같이 도는 꼴로 쓴다. `npm test` 의 `tests/pg-backend.test.mjs` 가 같은 경로를 node:sqlite 와 PGlite 에 돌려 응답·표를 비교한다.
- 원격 일괄 SQL: `node scripts/db/remote-sql.mjs <파일.sql | --command "…">` — `DB_BACKEND=pg` 면 Postgres 에 한 거래로 보낸다(Postgres 방언).
- 백업: PC 작업 「Wortling Backup」(`scripts/daily.mjs --no-text --no-image`)이 `backup/YYYY-MM-DD.sql.gz` 로 받는다(D1 내보내기와 같은 꼴 — `scripts/db/local-copy.mjs` 가 그대로 푼다). Supabase 무료 플랜은 자동 백업이 없다.
- 무료 플랜은 1주일 접속이 없으면 프로젝트가 멈춘다(앱·알림이 매일 닿으니 보통은 괜찮다). 멈추면 대시보드에서 Restore.

## 되돌리기

1. `wrangler.jsonc` 의 `"DB_BACKEND": "d1"` → `npm run deploy`. D1 `wortling` 은 지우지 않았다.
2. D1 은 10-30 17:19 KST 내보내기 이후 기록이 없다. 그 뒤 Postgres 에만 쌓인 기록(채점·연습·알림·단어 작업)은 따라오지 않으니,
   필요하면 최신 PC 백업(`backup/*.sql.gz`, `scripts/db/pg.mjs` dumpPg — SQLite 꼴)에서 바뀐 표만 골라 `remote-sql.mjs`(d1 모드)로 옮긴다.
3. D1 으로 돌아가면 0010·0011 색인을 먼저 적용한다(`npm run db:migrate:remote`) — 이전 때 D1 에는 0009 까지만 적용돼 있었다.

## 이전 기록 (2026-10-30)

- 17:19 KST `wrangler d1 export wortling --remote`(D1 읽기 한도 초과 중에도 됨). `d1_migrations` = 0001~0009 → 0010·0011 은 원격 D1 에 적용된 적 없음.
- `node scripts/db/d1-to-pg.mjs --schema <덤프>`: words 7,694 · cards 7,694 · reviews 327 · notifications 27 · settings 8 · word_changes 136 · news_days 16,931 · word_skips 889 · day_plans 5 · practice 117(word_reports · word_requests 0) — 덤프 = 이관 후. 시퀀스는 max(id, sqlite_sequence)+1.
- 대조: Supabase 를 다시 내려받아(dumpPg) SQLite 로 푼 것과 D1 내보내기가 12개 표 모두 칸까지 같음. 같은 Worker 경로 25개 응답이 D1 사본과 Postgres 에서 같음.
