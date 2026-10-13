# Wortling — 독일어 단어장 + 디스코드 알림(개인용)

B1~B2 단어 4,020개를 틴더처럼 밀어서 채점(ts-fsrs)하고, 아침 07:30 · 저녁 21:00 에 디스코드 웹훅으로 카드 한 통씩 받는다.
그림은 마스코트 「보르티」(닥스훈트)를 Higgsfield Z Image 로 **매일 무료 크레딧만큼 자동 생성**한다.

- 앱: https://wortling.e-hcg.workers.dev
- **연결은 클릭만**: 바탕화면 `Wortling 설정.html` 더블클릭 → 설정 화면에서 ① 폰 카메라로 QR 찍기 ② 디스코드 웹후크 URL 붙여넣고 「저장하고 시험 통 보내기」. 파일이 없으면 `npm run shortcut`.
- 화면: 라이트 모드 고정, 390px 우선, montage-web(브랜드 cyan 30 #006F82)

## 구성(저장소 하나 · Worker 하나 · 전부 Cloudflare 무료)

| 폴더 | 역할 |
|---|---|
| `src/` | React 19 + montage-web 화면 7경로(오늘 덱 · 단어 · 상세 · 기록 · 받은편지함 · 설정 · 온보딩) |
| `worker/` | Cloudflare Worker — API · 알림 시계(Durable Object 알람) · 그림 제공(KV) |
| `migrations/` | D1 스키마(words · cards · reviews · notifications · settings) |
| `scripts/seed/` | 단어 시드 — Goethe B1(DWDS) 1,800 + WordHoard B2 → DWDS 대조 → 사람 판정 = 2,220, kaikki 보강, 한국어 뜻·예문·장면 100% |
| `scripts/daily.mjs` | **매일 PC 에서** 빈 글 채우기(claude -p) + 그림 생성(higgsfield, 무료 하루 2크레딧 = 13장) |
| `shared/api.ts` | Worker ↔ 앱 계약(JSON 키) |

알림은 cron 대신 Durable Object 알람이다. 무료 계정 cron 5칸을 다른 Worker 가 다 쓰고 있어서다. 알람은 울릴 때마다 다음 칸(22:30Z · 12:00Z)을 스스로 다시 예약하고, 앱에서 오늘 화면을 열 때마다 비어 있으면 다시 채운다. 그림 저장은 R2 대신 Workers KV 다(계정에서 R2 가 꺼져 있음).

## 처음 한 번(이미 끝난 상태 — 다시 만들 때만)

```sh
npm ci
npx wrangler login
npx wrangler d1 create wortling --location apac      # id 를 wrangler.jsonc 에
npx wrangler kv namespace create wortling-img        # id 를 wrangler.jsonc 에
npm run db:migrate:remote
npm run seed:build && npm run seed:remote            # 빈 DB 에만(id 가 자리 번호)
npm run deploy
node -e "process.stdout.write(require('fs').readFileSync('.env','utf8').match(/^API_TOKEN=(.*)$/m)[1])" | npx wrangler secret put API_TOKEN
curl -X POST -H "Authorization: Bearer $API_TOKEN" https://wortling.e-hcg.workers.dev/api/admin/schedule   # 알림 시계 시작
```

## 매일 자동 그림(무료 플랜)

1. PC 에 `higgsfield auth login` · `higgsfield workspace set <id>` · `claude` 로그인이 되어 있어야 한다.
2. `.env` 에 `APP_URL` · `API_TOKEN`(`.env.example` 참고).
3. `powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1` → 매일 06:40(놓치면 PC 켜질 때 바로). 지우기는 `-Remove`.
4. 손으로: `npm run daily` (`-- --dry` 미리보기, `-- --no-image` 글만, `-- --no-text` 그림만).

하루 흐름: 학습 순서 앞쪽 60단어 중 빈 뜻·예문·장면을 `claude -p` 로 채움 → 잔여 크레딧 ÷ 0.15(상한 13)만큼 Z Image 생성 → 640×480 webp ≤ 60KB → Worker 관리 API 로 KV 에 올림 → D1 을 `backup/YYYY-MM-DD.sql.gz` 로 내려받아 30개 보관(공개 저장소엔 안 올림) → `backup/daily/YYYY-MM-DD.json` 기록. 실패하면 디스코드(AI_CLI 알림)로 오류 한 통. 그림이 아직 없는 카드는 머리글자 칸으로 보인다. 4,020장을 무료로 다 채우려면 약 300일.

## 검사

```sh
npm test                 # FSRS · 디스코드 통 · 알림 칸 · 덱 세션 17장(G4)
npm run typecheck:worker
npm run gate             # Playwright 7경로 × 390/1280 × 라이트/다크 설정 — 넘침 0 · 콘솔 오류 0 · 흰 바탕 · 덱 밀기
node scripts/seed/verify.mjs   # G1: 임시 로컬 D1 에 시드 → 수 세기
```

## 자료 출처

Goethe-Zertifikat B1 단어 목록(DWDS 제공, 목록만 사용) · DWDS 표제어 목록(B2 대조) · WordHoard(CC BY-SA 4.0) · kaikki.org / English Wiktionary(CC BY-SA) · Tatoeba(CC BY 2.0 FR) · 한국어 뜻·예문·장면은 Claude 생성 · 그림 Higgsfield(약관 §4.4 · §5.5 AI 생성물).
