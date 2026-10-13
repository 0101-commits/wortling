# Wortling 웹 푸시 — 설계와 작업 순서 (2026-10-13)

## 왜
사용자 지시(2026-10-13): 폰 알림 경로를 고정한다. Wortling = **디스코드 + 웹앱 푸시**, 웹앱은 모든 알림을 울린다.
지금은 디스코드 웹훅만 있고(웹훅 미설정이면 0통), 웹 푸시는 v6 기획에서 뺐다.

## 무엇을 (승인된 범위)
1. **열쇠**: VAPID P-256 쌍. 공개 열쇠 = `wrangler.jsonc` `vars.VAPID_PUBLIC_KEY`(base64url 65바이트), 비밀 열쇠 = Worker 비밀값 `VAPID_PRIVATE_KEY`(base64url 32바이트 d), 주체 = `vars.VAPID_SUBJECT`(`mailto:` 주소). 열쇠 사본은 저장소 밖 `.env` 옆(`C:\Users\cgpar\.secrets\wortling\`)에.
2. **기기 등록 주소** (접속 키 `Bearer API_TOKEN` 필요, 기존 인증 그대로)
   - `GET /api/push/key` → `{ publicKey }`
   - `POST /api/push/subscribe` body = `PushSubscription.toJSON()` → 같은 endpoint 면 덮어씀, 상한 10대
   - `DELETE /api/push/subscribe` body `{ endpoint }`
   - 저장 = KV `IMG` 키 `_push`(JSON 배열 `{endpoint, keys:{p256dh,auth}, added}`). **D1 에 두지 않는다** — 매일 D1 내보내기와 섞이지 않게(웹훅 `_webhook` 과 같은 규칙).
3. **발송** (`worker/notify.ts` `dispatch`)
   - 디스코드와 푸시를 **서로 독립**으로 보낸다. 하나가 실패해도 다른 쪽은 간다.
   - 결과: 둘 중 하나라도 가면 `status='sent'`, 둘 다 실패면 `failed`. `error` 칸에 실패한 쪽 사유(`discord: …` / `push: …`).
   - 웹훅·구독이 둘 다 없을 때만 `no_channel` 실패(종전 `no_webhook` 은 디스코드 쪽 사유로 남김).
   - 푸시 내용 = `summarize(payload)` → `{ title, body(≤300자), image, url }`, url 은 버튼 링크(없으면 `APP_URL/#/today`), `tag` = kind(같은 종류 알림은 폰에서 하나로 겹침).
   - 404·410 응답 구독은 KV 목록에서 지운다. TTL 12시간, `Urgency: high`.
   - 라이브러리 `@block65/webcrypto-web-push` **2.0.0 고정**(MIT, Workers 지원, aes128gcm + VAPID).
4. **앱**
   - `public/sw.js`: `push` → `showNotification(title, {body, icon:'/mascot/_default.webp', image, tag, data:{url}})`, `notificationclick` → 열린 창 있으면 그 창으로, 없으면 `openWindow(url)`.
   - 설정 「알림」 칸: 「이 기기로 받기」 `Switch` — 켜면 서비스 워커 등록 → 권한 요청 → `subscribe({userVisibleOnly:true, applicationServerKey})` → POST. 끄면 `unsubscribe()` + DELETE. 지원 안 되는 브라우저(`!('PushManager' in window)`)면 스위치 대신 「이 브라우저는 알림을 못 받아요」 한 줄. 권한 거부 상태면 그 사실을 한 줄로.
   - 「시험 통」 토스트는 두 채널 결과를 함께: 예) 「디스코드 ○ · 이 기기 ○」.
   - 목업 모드(`VITE_MOCK=1`)에서는 스위치를 숨긴다.
5. **문구**: 「웹후크」 표기는 기존 화면 그대로 둔다. 새 문구는 우리말로.

## 안 하는 것
- 알림 종류·시각 추가 없음(아침 07:30 · 저녁 21:00 · 시험 통 그대로).
- 기기별 설정·조용한 시간 없음(알림이 하루 두 통뿐).
- 디스코드 쪽 변경 없음.

## 작업 순서
1. `npm i @block65/webcrypto-web-push@2.0.0 --save-exact`
2. `worker/push.ts`: 구독 목록 읽기·쓰기(KV), `pushAll(env, msg)` → `{ ok, sent, failed, gone, error? }`, `pushMessage(summary, kind, appUrl)` 순수 함수.
3. `worker/notify.ts` `dispatch` 를 두 채널 독립으로, `worker/index.ts` 에 주소 3개, `worker/env.ts` 에 `VAPID_*`.
4. `public/sw.js`, `src/push.ts`(등록·해제 도우미), `src/api.ts` 호출 3개, `Settings.tsx` 스위치·시험 통 문구, `src/mock.ts` 필요 시.
5. 시험(`tests/worker.test.mjs` 또는 새 `tests/push.test.mjs`): `pushMessage` 모양·자르기·기본 url, dispatch 독립성(가짜 fetch: 디스코드 실패·푸시 성공 → sent / 둘 다 실패 → failed / 410 구독 제거). `npm test` · `npm run typecheck:worker` · `npm run build` · `npm run gate` 통과.
6. 열쇠 만들기 → `vars` · 비밀값 넣기 → 배포 → `/api/push/key` 확인 → 시험 구독(가짜 endpoint 아님, 실제 브라우저)으로 시험 통 1회.

## 게이트
- 시험·타입·빌드·화면 게이트 통과.
- 실제 브라우저 구독 1개로 시험 통 → 브라우저 알림 표시 확인.
- 폰 확인은 사용자 몫(설정에서 스위치 켜기 → 시험 통).
