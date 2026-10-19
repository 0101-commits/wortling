# Wortling — 독일어 단어장 + 디스코드 알림(개인용)

B1~C1 단어 8,347개를 틴더처럼 밀어서 채점(ts-fsrs)하고, 아침 07:30 · 저녁 21:00 에 디스코드 웹훅으로 카드 한 통씩 받는다.
그림은 마스코트 「보르티」(닥스훈트) 손그림체를 Cloudflare Workers AI(FLUX.2 klein 4b)로 **매일 무료 몫(하루 10,000 뉴런 ≈ 120장)만큼 자동 생성**한다.

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
| `scripts/daily.mjs` | **매일 깃허브 서버에서**(`.github/workflows/daily.yml`, 12:17) 빈 글 채우기(Gemini) + 그림 생성(Workers AI FLUX.2 klein 4b, 무료 하루 ≈ 100장) |
| `scripts/words/` | **매일 서버에서**(`.github/workflows/words.yml`, 05:17) 카드 검토(뜻·예문·번역·관사·레벨, 자동 고침 + 기록·되돌리기) · 내가 넣은 단어 · 뉴스 단어 추가 · 학습 순서 |
| `scripts/words/update.mjs` | 손으로 돌리는 예전 단어 갱신(WordHoard·DWDS, PC 전용, 뜻 채우기는 Gemini — `.env` 에 `GEMINI_API_KEY`) |
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

1. 깃허브 서버가 매일 12:17 에 돈다(`.github/workflows/daily.yml`, PC 가 꺼져 있어도). 저장소 비밀값 4개: `APP_URL` · `API_TOKEN`(`.env` 와 같음) · `GEMINI_API_KEY`(글·장면·뜻 검사·카드 검토용, aistudio.google.com/apikey 무료 몫 — 2026-10-19 claude 구독 토큰에서 바꿈) · `DISCORD_WEBHOOK_URL`. 그림은 Worker 의 `POST /api/admin/draw`(Workers AI 바인딩 `AI`)가 그린다. 손으로 돌리기: Actions → daily → Run workflow.
2. D1 백업은 공개 저장소라 PC 에서만: `.env` 에 `APP_URL` · `API_TOKEN`(`.env.example` 참고) → `powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1` → 평일 12:00 「Wortling Backup」(놓치면 PC 켜질 때 바로). 지우기는 `-Remove`.
3. 그림 상태(`.data/restyle.json` 예전 그림체 목록 · `.data/images-done.json` 전부 완료 표시)는 깃허브 작업이 저장소에 되올린다.
4. 손으로: `npm run daily` (`-- --dry` 미리보기, `-- --no-image` 글만, `-- --no-text` 그림만).

하루 흐름: 학습 순서 앞쪽 60단어 중 빈 뜻·예문·장면을 Gemini 로 채움 → 그릴 단어(오늘 덱 → 예전 그림체 → 학습 순서) 장면을 Gemini 로 새로 쓰고 하루 100장까지 생성(무료 몫을 다 쓰면 429 → 그날 멈춤) → 자동 검사(흰 바탕·색 수·선·글자 0, 탈락이면 한 번 더) → 640×480 webp ≤ 60KB → Worker 관리 API 로 KV 에 올림 → D1 을 `backup/YYYY-MM-DD.sql.gz` 로 내려받아 30개 보관(공개 저장소엔 안 올림) → `backup/daily/YYYY-MM-DD.json` 기록. 실패하면 디스코드(AI_CLI 알림)로 오류 한 통. 그림이 아직 없는 카드는 머리글자 칸으로 보인다. 8,347장을 무료로 다 채우려면 약 85일.

## 검사

```sh
npm test                 # FSRS · 디스코드 통 · 알림 칸 · 덱 세션 17장(G4)
npm run typecheck:worker
npm run gate             # Playwright 7경로 × 390/1280 × 라이트/다크 설정 — 넘침 0 · 콘솔 오류 0 · 흰 바탕 · 덱 밀기
node scripts/seed/verify.mjs   # G1: 임시 로컬 D1 에 시드 → 수 세기
```

## 자료 출처

Goethe-Zertifikat B1 단어 목록(DWDS 제공, 목록만 사용) · DWDS 표제어 목록(B2 대조) · WordHoard(CC BY-SA 4.0) · kaikki.org / English Wiktionary(CC BY-SA) · Tatoeba(CC BY 2.0 FR) · 한국어 뜻·예문·장면은 Claude·Gemini 생성 · 그림 FLUX.2 [klein] 4B(Cloudflare Workers AI, AI 생성물).

## 단어 자료 출처 · 라이선스

| 자료 | 쓰는 곳 | 라이선스 |
|---|---|---|
| [Leipzig Corpora Collection](https://wortschatz-leipzig.de/) 독일어 뉴스 300K | 뉴스에 자주 나오는 단어 · 학습 순서 | CC BY |
| [kaikki.org](https://kaikki.org/) 독일어(영어판 Wiktionary 추출) | 활용형 → 기본형 · 관사·복수 대조 | CC BY-SA |
| [DAFlex](https://cental.uclouvain.be/cefrlex/daflex/) (UCLouvain) | 레벨 대조 · A1/A2 거르기 | CC BY-NC-SA 4.0 — 비영리, 파생 자료는 저장소에 안 올림 |
| tagesschau API · NDR 쉬운 말 RSS | 최근 30일 기사에 나온 기본형 수(글은 저장 안 함, 링크만) | 개인·비영리 이용, `NEWS_FEEDS=0` 으로 끔 |

KBS World Radio · DW 는 이용 조건상 자동 수집을 하지 않는다 — 앱 「단어 넣기」(폰 공유하기)로 읽다가 만난 단어를 직접 넣는다.
