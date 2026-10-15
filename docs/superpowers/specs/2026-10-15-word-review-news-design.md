# Wortling 카드 정기 검토 · 뉴스 단어 추가 — 설계 (2026-10-15)

## 왜
사용자 지시(2026-10-15): 「정기적으로 각 단어의 예문·레벨·번역이 맞는지 검토하고, 신규 단어를 정기적으로 추가. PC 없이. KBS·DW 같은 데서 가져오거나 더 좋은 방향을 다각도로.」 계기 = 「둘 다, 미리 대비」(틀린 카드를 본 건 아님).

현황(10-15 실측):
- 단어 8,347개(B1 1,800 · B2 2,220 · C1 4,327) **전부** `gloss_status='generated'` · `example_src='gen'` — Claude 가 쓴 채로 검토 0. `checked` 상태는 표에 있지만 안 쓴다.
- 새 단어 길 `scripts/words/update.mjs` 는 PC 전용(.data 1GB · DWDS 표제어 CSV 는 받을 주소 없음)이고 후보가 바닥났다(WordHoard·DWDS C1 4,327 을 10-14 에 다 넣음). PC 작업 「Wortling Words」 는 한 번도 안 돌았다(결과 267011).
- 학습 21장. 하루 새 단어 5개면 덱 소진에 4년 반 → 양보다 **곧 볼 카드가 맞는가 · 뉴스에서 실제 만나는 단어가 먼저 나오는가**가 중요.
- 2025 독일 뉴스(Leipzig 100K) 상위 단어형 1만 개를 kaikki 로 기본형으로 바꿔 덱과 대조 → 덱에 없는 B1 이상 단어 어림 수백~1,000개(예: Ermittlung · ermitteln · Landkreis · Bundesregierung · Vorfall · Vorjahr · Soldat · Verfahren · hingegen · dennoch). 덱 C1 은 영화 자막 빈도라 뉴스와 거리가 있다.

## 출처와 조건 (10-15 조사)
| 출처 | 쓰임 | 조건 | 판정 |
|---|---|---|---|
| KBS World Radio 독일어 | — | 페이지 「Keine Kopie, Verbreitung oder Nutzung des Inhalts (einschließlich maschinellen Lernens)」, robots 검색 로봇 외 전부 차단 | **자동 수집 안 함** — 사람이 읽다 고른 단어만(「단어 넣기」) |
| DW (rss.dw.com · learngerman) | — | robots 「data mine or scrape … prohibited without prior written permission」 | **자동 수집 안 함** — 「단어 넣기」만 |
| tagesschau API `api2u/news/` | 뉴스 신호(C) | bundesAPI 「privaten, nicht-kommerziellen Gebrauch gestattet, Veröffentlichung nicht」, 시간당 60회. robots 에 §44b(3) 유보(출처 밝힌 RAG 예외) | 회색 — 제목·요약에서 기본형 수만 셈, 글 저장 0, 스위치로 끔 |
| NDR 쉬운 말 뉴스 RSS | 뉴스 신호(C) | robots 에 §44b(3) 유보 | 회색 — 위와 같은 방식 |
| Leipzig `deu_news_<해>_300K` | 뉴스 빈도(A) | CC BY | 사용(출처 표기). 1년 늦음 |
| kaikki 독일어(영어판 위키낱말사전) | 기본형 변환 · 관사·복수·활용 대조 | CC BY-SA | 사용(출처 표기) |
| DAFlex (UCLouvain) | 레벨 대조 · A1/A2 거르기 | CC BY-NC-SA 4.0 | 사용 — 비영리, 저장소에 파생 자료 커밋 안 함 |

사용자 몫(선택): tagesschau 에 허락 메일(webmaster@tagesschau.de). 답이 거절이면 `NEWS_FEEDS=0`.

## 무엇을 (승인된 범위 = A안 + C안, 고침은 자동 적용)

### 1. 매일 작업 `words.yml` (GitHub Actions, 매일 05:17 KST)
07:30 아침 알림 전에 오늘 볼 카드를 검토해 두려고 05:17. 그림 작업(daily.yml 12:17)과 안 겹친다. `ubuntu-latest`(그림 OCR 이 없으니 Windows 불필요). 비밀값은 daily.yml 과 같은 4개(APP_URL · API_TOKEN · CLAUDE_CODE_OAUTH_TOKEN · DISCORD_WEBHOOK_URL).

순서(단계마다 따로 try — 한 단계가 실패해도 다음 단계는 돈다):
1. **원본 준비** `sources.mjs` — Actions 캐시(월 단위 열쇠)에 kaikki 독일어 전체(gz ≈98MB) · DAFlex(4.7MB) · Leipzig 뉴스 300K(≈70MB, 해마다)를 받아 작은 색인으로 만든다: 활용형→기본형, 기본형→{성·복수·활용형}, 기본형→DAFlex 첫 등장 레벨, 기본형→Leipzig 순위. 받기 실패면 캐시에 남은 이전 색인으로 계속.
2. **내가 넣은 단어** — `word_requests` 의 대기 줄. 활용형으로 넣어도(ermittelte) Claude 가 기본형·품사를 정한다. 덱에 있으면 `pinned=1`, 없으면 카드를 만들어 `pinned=1`. 상태를 added/exists/rejected 로.
3. **뉴스 신호(C)** — `NEWS_FEEDS` 가 0 이 아닐 때만. tagesschau API 1회 + NDR RSS 1회, 제목·요약(첫 문장)만 토막 내 기본형으로 바꿔 `news_days(day, key, n)` 에 더한다. 기사 링크는 그 기본형의 마지막 1개만. **글은 D1·로그·저장소 어디에도 남기지 않는다**(로그엔 수만). 60일 지난 줄은 지운다.
4. **새 단어** — 덱에 없고, kaikki 명사·동사·형용사·부사 기본형이고, DAFlex 첫 레벨이 A1·A2 가 아니고, (Leipzig 순위 ≤ 20,000 **또는** 최근 30일 뉴스 2회 이상)인 것을 점수순으로 하루 **최대 30개**. 내용은 update.mjs 의 `writeContent`(keep 판정·뜻·예문·장면)를 함께 쓴다. 레벨 = DAFlex 첫 레벨(b1→B1, b2→B2, c1·c2→C1, 모르면 C1), `level_src='news'`.
5. **학습 순서 재정렬** — 열쇠(`key`)는 어디서나 `소문자 기본형|품사`. 색인을 새로 만든 날엔 덱 단어의 `news_rank`(Leipzig 순위)를 바뀐 것만 채우고, 서버 `reseq` 가 먼저 `news_hits30 = 최근 30일 news_days 합`을 다시 센 뒤 seq 를 매긴다. 아직 안 배운 카드(`cards.state=0 AND introduced_at IS NULL`)만. 순서 = `pinned DESC, level(B1→B2→C1), (news_hits30 ≥ 2) DESC, news_rank, freq_rank, lemma`. 레벨 순서는 그대로, 같은 레벨 안에서 뉴스 단어가 앞. seq 가 바뀌는 줄만 쓴다.
6. **검토** `review.mjs` — 하루 **250개**(25개 묶음 × 10번 Claude). 9천 개 한 바퀴 ≈36일.
7. **알림** — 오류는 그때그때, 요약(검토·고침·확인 필요·새 단어·넣은 단어·남은 순환 %)은 일요일 1번. 경로 = DISCORD_WEBHOOK_URL(AI_CLI 알림 채널, daily.mjs 의 `notify` 와 같음).

### 2. 검토 규칙
**고르는 순서**(서버 `GET /api/admin/review-queue?limit=250` 가 한 번에):
1. 「이상해요」 신고가 열린 카드
2. 앞으로 14일 안에 나올 새 카드(seq 순 앞에서 `14 × new_per_day` 개)
3. 3일 안에 복습할 카드
4. 나머지 — `checked_at IS NULL` 을 seq 순, 다음에 `checked_at` 이 180일 지난 것

**기계 근거**(색인에서, 네트워크 없이):
- kaikki: 성(여럿이면 모두) · 복수 · 활용형 목록
- DAFlex 첫 등장 레벨 → B1/B2/C1 로 환산
- 예문에 표제어 활용형이 들어 있는가(분리동사는 어간 활용형 + 문장 끝 접두어도 인정)

**Claude 판정** — 25개 묶음 + 기계 근거 → 단어마다 `{id, ok, fix:{gloss_ko?, example_de?, example_ko?, gender?, plural?, level?}, meaning_changed, why}`. 깨진 JSON 은 `askJson` 처럼 1번 다시 묻는다.

**적용 규칙**(순수 함수 `decide(word, facts, verdict, reverted)` → `{patch, flags}`):
| 칸 | 자동 적용 조건 |
|---|---|
| gloss_ko | Claude 고칠 값 + 형식 검사(40자 이내). `gloss_status='mine'` 이면 안 바꿈 |
| example_de + example_ko | 둘 다 왔을 때만, 예문 70자 이내 · 표제어 활용형 포함 · 번역 80자 이내 |
| gender · plural | kaikki 값과 Claude 고칠 값이 같을 때만 |
| level | DAFlex 환산 레벨과 Claude 고칠 값이 같을 때만 |
| 그 밖 · 근거 엇갈림 | 고치지 않고 「확인 필요」 표시 |
| 사용자가 되돌린 적 있는 (단어, 칸) | 자동 적용 안 함 → 「확인 필요」 |

- 적용하면 `word_changes` 에 원래 값·새 값·이유를 남기고 `checked_at=now`, `gloss_status='checked'`(mine 은 그대로).
- 신고된 카드인데 Claude 가 「맞음」이면 「확인 필요」로 남겨 사용자가 본다. 신고는 검토가 끝나면 닫는다.
- `meaning_changed` 면 `image_status='none'` → 매일 그림 작업이 장면을 새로 쓰고 다시 그린다. 새 그림 전까지 기존 그림을 그대로 보여 준다(앱은 상태와 상관없이 `/img/<id>.webp` 를 읽는다).

### 3. 앱
- **카드 뒷면 「이상해요」** — 뜻 · 예문 · 관사·복수 · 레벨 · 그림 · 기타 중 고르고 한 줄 메모(선택) → `POST /api/words/:id/report`. 「내일 아침 전에 다시 볼게요」 토스트.
- **단어장 「단어 넣기」** — 단어(활용형 가능) + 기사 링크(선택) → `POST /api/requests`. 아래에 최근 넣은 10개와 상태(대기·추가됨·이미 있음·제외).
- **폰 공유하기** — `manifest.json` `share_target`(GET, title·text·url) → 「단어 넣기」 칸에 채워 연다. 안드로이드에서 앱을 설치한 경우만, 아이폰은 붙여넣기.
- **고친 카드** `#/changes` — 최근 고침과 「확인 필요」 목록(표제어 · 칸 · 전 → 후 · 이유 · 날짜), 고침마다 「되돌리기」(`POST /api/changes/:id/revert`, 지금 값이 그 고침의 새 값일 때만 — 아니면 409). 설정 화면에서 들어간다.

### 4. DB (마이그레이션 0004)
- `words` 칸 추가: `checked_at TEXT` · `news_rank INTEGER`(Leipzig 기본형 순위) · `news_hits30 INTEGER NOT NULL DEFAULT 0` · `pinned INTEGER NOT NULL DEFAULT 0`
- `word_changes(id, word_id, field, old, new, why, source('review'|'report'), applied 0/1, reverted_at, at)` — 인덱스 (at), (word_id, field)
- `word_reports(id, word_id, kind, note, created_at, closed_at)`
- `word_requests(id, text, url, created_at, status('queued'|'added'|'exists'|'rejected'), word_id, note)`
- `news_days(day, key, n, url, PRIMARY KEY(day, key))`
- 새 카드 고르기(`worker/deck.ts`) 조건: `w.level IN (…) OR w.pinned = 1` — 넣은 단어는 레벨 설정과 상관없이 나온다.

### 5. Worker 주소
기존 `POST /api/admin/words`(칸 고치기)를 넓혀 `why` · `applied` 를 받으면 같은 batch 안에서 `word_changes` 를 쓴다. 새로:
- `GET /api/admin/review-queue?limit=` · `GET /api/admin/requests?status=queued` · `POST /api/admin/requests/:id`
- `POST /api/admin/news` `{day, items:[{key, n, url}]}` (upsert) · `POST /api/admin/reseq`(위 순서로 seq 다시 매김, 바뀐 줄 수 반환)
- 앱: `POST /api/words/:id/report` · `POST /api/requests` · `GET /api/requests` · `GET /api/changes` · `POST /api/changes/:id/revert`
- `POST /api/admin/words/insert` 는 `level_src` 에 `news` · `mine` 허용, `pinned` 받기

### 6. 스크립트 배치
- `scripts/words/lib.mjs` — 순수 함수: 토막 내기 · 기본형 바꾸기 · `decide` · 후보 고르기 · 점수. `writeContent` 를 update.mjs 에서 옮겨 둘이 함께 쓴다.
- `scripts/words/sources.mjs` · `news.mjs`(2~5단계) · `review.mjs`(6단계). 둘 다 `--dry`(쓰기 없이 수만 출력)와 `--max=N`.
- PC 작업 「Wortling Words」 는 지운다(register-task.ps1 에서도). update.mjs 는 손으로 돌릴 수 있게 남긴다.
- README 에 출처·라이선스 표기(Leipzig CC BY · kaikki/Wiktionary CC BY-SA · DAFlex CC BY-NC-SA · tagesschau/NDR 링크만).

## 오류 처리
- 단계별 독립. 원본 받기 실패 → 이전 캐시 색인. 색인이 아예 없으면 기계 근거 없이 검토하되 관사·복수·레벨은 고치지 않는다(규칙상 자동으로 「확인 필요」).
- Claude 실패(묶음) → 그 묶음만 건너뛰고 다음 날 다시(체크 안 됐으니 다시 고른다). 3묶음 연속 실패면 그날 검토를 멈추고 오류 알림.
- 뉴스 받기 실패 → 그날 뉴스 신호만 건너뜀. 여러 날 연속이면 요약에 표시.
- 묶음마다 서버에 바로 쓴다 — 중간에 멈춰도 한 일은 남는다.

## 시험
- `tests/words.test.mjs`(node --test): 토막·기본형(분리동사 포함) · `decide` 규칙 표의 각 줄 · 후보 거르기(A1/A2 제외·이미 있음 제외) · 재정렬 순서.
- `tests/worker.test.mjs` 에 주소 시험 추가: review-queue 순서 · 고치기 + 기록 · 되돌리기 409 · reseq 가 배운 카드는 안 건드림 · pinned 가 레벨 설정을 넘어 나옴.
- `--dry` 로 원격에 쓰기 없이 한 번(수·예시 확인) → workflow_dispatch 로 실제 한 번.

## 안 하는 것
- KBS·DW 자동 수집(조건상 금지). 위키백과 시사 수집(B안, 이번 범위 밖).
- 숙어(Redewendung) 카드 추가 — 덱에 phrase 1개뿐이지만 이번 범위 밖.
- 고침 승인 대기 화면(자동 적용으로 결정). 레벨 자동 승급·강등 규칙.
- 기사 본문·제목 저장, 뉴스 읽기 화면.

## 열린 점 (구현 첫 단계에서 실측)
- △ tagesschau API · NDR RSS 가 GitHub Actions(미국 IP)에서 열리는지 — 안 열리면 C 는 꺼 두고 요약에 표시.
- △ kaikki 독일어 전체 gz 주소·크기(조사 때 98MB), 색인 크기가 Actions 캐시에 맞는지.
- △ `share_target` 이 해시 길 찾기(`#/…`)와 맞는지 — 안 맞으면 `/add` 를 Worker 가 `/#/add?…` 로 넘긴다.
- △ D1 이 `UPDATE … FROM (SELECT … row_number() OVER …)` 를 받는지 — 안 받으면 batch 로 바뀐 줄만.
