# 카드 정기 검토 · 뉴스 단어 추가 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC 없이(GitHub Actions 매일 05:17 KST) 카드 8,347개의 뜻·예문·번역·관사·레벨을 순환 검토해 자동으로 고치고(기록·되돌리기), 뉴스에 자주 나오는 단어와 내가 넣은 단어를 새 카드로 넣고, 학습 순서를 뉴스 단어 먼저로 다시 매긴다.

**Architecture:** Worker 에 DB 함수 모음 `worker/words.ts`(시험 가능한 순수 DB 함수) + 얇은 처리기. 스크립트는 `scripts/words/lib.mjs`(순수 함수) · `sources.mjs`(kaikki·DAFlex·Leipzig 색인) · `news.mjs`(넣은 단어·뉴스 신호·새 단어·순서) · `review.mjs`(검토) — `words.yml` 이 차례로 부른다. 앱은 「이상해요」 신고 · 「단어 넣기」(폰 공유하기) · 「고친 카드」 화면.

**Tech Stack:** Cloudflare Worker + D1(SQLite) · Node 24(`node:sqlite` 로 D1 흉내 시험, `.ts` 바로 읽기) · React 19 + montage-web · claude CLI(`scripts/claude.mjs` askJson) · GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-15-word-review-news-design.md`

## Global Constraints

- Node 24. Worker·shared `.ts` 는 지울 수 있는 문법만(enum·namespace·생성자 매개변수 속성 금지) — 시험이 `.ts` 를 바로 읽는다.
- 새 npm 의존성 0. 표준 라이브러리 · 이미 있는 것(montage · motion)만.
- 공개 저장소: 뉴스 글(제목·요약)·DAFlex 파생 자료·키를 커밋하지 않는다. Actions 로그에도 뉴스 글을 찍지 않는다(수만).
- 화면 글·주석은 우리말(파일·함수 이름만 그대로). Tailwind 금지, 색은 `src/app.css` 토큰(`--paper` `--ink` `--ink2` `--ink3` `--line` `--warn-bg`).
- 자동 적용 규칙 = 설계 「2. 검토 규칙」 표 그대로(뜻·예문·번역 = Claude + 형식 검사 · 관사·복수 = 위키낱말사전 일치 · 레벨 = DAFlex 일치 · 되돌린 칸·mine 은 안 바꿈).
- 열쇠 규칙 하나: `기본형|품사`, 앞 `sich ` 뺌, 대소문자 그대로 — JS `wordKey` 와 SQL `KEY_SQL` 이 같아야 한다.
- D1 batch 한 번에 문장 400개 이하(10-14 실측 400 성공). 스크립트는 400개씩 나눠 보낸다.
- tagesschau 는 하루 1회(조건: 시간당 60회 이하), User-Agent 에 앱 이름. 스위치 `NEWS_FEEDS=0`.
- 시각: `words.yml` cron `'17 20 * * *'`(= 05:17 KST).
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 함정: Git Bash heredoc 은 백슬래시를 깬다 → 백슬래시 든 파일은 Write/Edit 로만. `wrangler d1` 일시 인증 오류(7403/10000)는 다시 하면 된다.

## Review Focus

시험이 없으면 사람이 처음 써 볼 때 가장 먼저 부딪힐 것 다섯(각각 맡은 작업에 시험을 넣었다):
1. Claude 판정이 엉뚱한 모양(모르는 id · 빠진 id · fix 칸 타입이 틀림 · gender `'m'`) → 무시하거나 「확인 필요」로, 이상한 값을 카드에 쓰지 않는다 — Task 4 `acceptVerdicts`·`decide` 시험.
2. 사용자가 되돌린 칸을 다음 순환에 또 고치려 함 → 안 바꾸고 「확인 필요」 — Task 4 `decide` 시험.
3. 「단어 넣기」에 주소·이모지·61자·빈 값 → 400. 폰 공유하기로 「기사 제목 + 주소」가 오면 주소는 링크 칸, 단어 칸은 비움 — Task 3 `addRequest` · Task 8 `fromShare` 시험.
4. 되돌린 뒤 또 바뀐 카드 · 두 번 되돌리기 · 「확인 필요」(안 바꾼 것) 되돌리기 → 409 — Task 3 `revertChange` 시험.
5. 뉴스 응답이 HTML 오류 쪽 · 빈 JSON · item 없는 RSS → 0건, 서버에 안 씀, 지난 기록 그대로 — Task 4 `parseTagesschau`·`parseRss` 시험 + Task 6 `if (!counts.size) return`.

---

## 파일 지도

| 파일 | 할 일 |
|---|---|
| `migrations/0004_review_news.sql` (새) | words 칸 4 + 표 5 |
| `worker/http.ts` (새) | `HttpError` · `bad` (index.ts 에서 옮김) |
| `worker/words.ts` (새) | 검토·뉴스·신고·넣기·고침 DB 함수 |
| `worker/index.ts` | 처리기를 words.ts 호출로, 주소 12개 추가, 옛 adminKeys·adminInsert·adminWords 본문 삭제 |
| `worker/deck.ts` | 새 카드 고르기에 `OR w.pinned = 1`, `ORDER BY w.pinned DESC, w.seq` |
| `shared/api.ts` | 새 형 · AdminWordsRequest 넓힘 |
| `shared/request.ts` (새) | `REQ_TEXT` (서버·앱·스크립트 공용) |
| `tests/d1.mjs` (새) | node:sqlite D1 흉내 + `addWord` |
| `tests/words-db.test.mjs` (새) | Task 1~3 시험 |
| `scripts/words/lib.mjs` (새) | 순수 함수 |
| `scripts/words/sources.mjs` (새) | 원본 받기 + 색인 |
| `tests/words-lib.test.mjs` (새) | Task 4·5·8 시험 |
| `scripts/admin.mjs` (새) | api · notify · 날짜 |
| `scripts/words/news.mjs` · `review.mjs` (새) | 매일 작업 1/2 · 2/2 |
| `scripts/words/update.mjs` | writeContent 를 lib 의 contentPrompt·acceptContent 로 |
| `src/share.ts` · `src/Report.tsx` · `src/AddWord.tsx` · `src/screens/Changes.tsx` (새) | 앱 |
| `src/api.ts` · `src/main.tsx` · `src/App.tsx` · `src/screens/{Today,WordDetail,Words,Settings}.tsx` · `src/mock.ts` · `src/app.css` · `public/manifest.webmanifest` · `scripts/gates/ui.mjs` | 앱 연결 |
| `.github/workflows/words.yml` (새) · `scripts/register-task.ps1` · `README.md` | 운영 |

---

### Task 1: DB 0004 · D1 흉내 · 넣은 단어가 레벨을 넘어 나오기

**Files:**
- Create: `migrations/0004_review_news.sql`, `worker/http.ts`, `tests/d1.mjs`, `tests/words-db.test.mjs`
- Modify: `worker/index.ts:27-34`(HttpError·bad 삭제, import 추가), `worker/deck.ts:96-102`

**Interfaces:**
- Produces: `fakeD1(): D1Database & { raw: DatabaseSync }`, `addWord(db, partialRow)`; `HttpError(status, message)`, `bad(message)` from `worker/http.ts`; 표 `word_changes(id, word_id, field, old, new, why, source, applied, reverted_at, at)` · `word_reports(id, word_id, kind, note, created_at, closed_at)` · `word_requests(id, text, url, created_at, status, word_id, note)` · `news_days(day, key, n, url)` · `word_skips(key, reason, at)`; words 칸 `checked_at` `news_rank` `news_hits30` `pinned`.

- [ ] **Step 1: D1 흉내 만들기** — `tests/d1.mjs`

```js
// D1 흉내(node:sqlite): migrations/*.sql 을 차례로 적용한 메모리 DB. 시험 전용.
// D1 과 같은 꼴: prepare().bind().all()/first()/run(), batch([...]) 는 한 거래로.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const MIG = new URL('../migrations/', import.meta.url);
// node:sqlite 는 undefined·boolean 을 못 받는다
const arg = (v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v);
const RETURNS_ROWS = /^\s*(SELECT|WITH|PRAGMA)\b|\bRETURNING\b/i;

class Stmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Stmt(this.db, this.sql, args.map(arg));
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args), success: true, meta: { changes: 0 } };
  }
  async first(col) {
    const r = this.db.prepare(this.sql).get(...this.args);
    if (r === undefined) return null;
    return col ? r[col] : r;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  exec() {
    return RETURNS_ROWS.test(this.sql) ? this.all() : this.run();
  }
}

export function fakeD1() {
  const raw = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(f, MIG), 'utf8'));
  return {
    raw,
    prepare: (sql) => new Stmt(raw, sql),
    async batch(stmts) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.exec());
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** 단어 + 카드 한 쌍. 안 준 칸은 새 B1 명사(state 0) */
export function addWord(db, w) {
  const r = {
    pos: 'noun', gender: null, plural: null, level: 'B1', level_src: 'goethe', gloss_ko: '뜻', gloss_status: 'generated',
    example_de: null, example_ko: null, seq: 1, pinned: 0, news_rank: null, freq_rank: null, checked_at: null, image_status: 'none',
    state: 0, due: '2026-10-01T00:00:00.000Z', introduced_at: null, ...w,
  };
  db.raw
    .prepare(`INSERT INTO words(id, lemma, pos, gender, plural, level, level_src, gloss_ko, gloss_status, example_de, example_ko,
      seq, pinned, news_rank, freq_rank, checked_at, image_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.id, r.lemma, r.pos, r.gender, r.plural, r.level, r.level_src, r.gloss_ko, r.gloss_status, r.example_de, r.example_ko,
      r.seq, r.pinned, r.news_rank, r.freq_rank, r.checked_at, r.image_status);
  db.raw.prepare('INSERT INTO cards(word_id, state, due, introduced_at) VALUES (?, ?, ?, ?)').run(r.id, r.state, r.due, r.introduced_at);
}
```

- [ ] **Step 2: 실패하는 시험 쓰기** — `tests/words-db.test.mjs`

```js
// 카드 검토·뉴스 단어 DB 함수 시험: 0004 마이그레이션 + D1 흉내(tests/d1.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1, addWord } from './d1.mjs';
import { buildToday, loadSettings } from '../worker/deck.ts';

test('0004: words 새 칸 4 · 새 표 5', () => {
  const db = fakeD1();
  const cols = db.raw.prepare("SELECT name FROM pragma_table_info('words')").all().map((r) => r.name);
  for (const c of ['checked_at', 'news_rank', 'news_hits30', 'pinned']) assert.ok(cols.includes(c), c);
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['word_changes', 'word_reports', 'word_requests', 'news_days', 'word_skips']) assert.ok(tables.includes(t), t);
});

test('pinned: 레벨 설정(B1) 밖의 C1 단어도 새 카드 맨 앞', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', seq: 1 });
  addWord(db, { id: 'w0002', lemma: 'Ermittlung', level: 'C1', seq: 2, pinned: 1 });
  addWord(db, { id: 'w0003', lemma: 'Kuchen', level: 'C1', seq: 3 });
  const s = await loadSettings(db);
  assert.equal(s.level, 'B1');
  const t = await buildToday(db, s, new Date('2026-10-15T00:00:00Z'));
  assert.deepEqual(t.fresh.map((x) => x.word.id), ['w0002', 'w0001']);
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --test tests/words-db.test.mjs`
Expected: FAIL — `no such column: checked_at`(0004 없음)

- [ ] **Step 4: 마이그레이션** — `migrations/0004_review_news.sql`

```sql
-- Wortling 0004: 카드 정기 검토 · 뉴스 단어 · 신고 · 내가 넣은 단어
-- 설계 docs/superpowers/specs/2026-10-15-word-review-news-design.md
ALTER TABLE words ADD COLUMN checked_at TEXT;                         -- 마지막 검토 시각(ISO)
ALTER TABLE words ADD COLUMN news_rank INTEGER;                       -- Leipzig 뉴스 말뭉치 기본형 순위(1 = 가장 자주)
ALTER TABLE words ADD COLUMN news_hits30 INTEGER NOT NULL DEFAULT 0;  -- 최근 30일 tagesschau·NDR 제목·요약에 나온 기사 수
ALTER TABLE words ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;       -- 내가 넣은 단어: 레벨 설정과 상관없이 새 카드 맨 앞

CREATE TABLE word_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id TEXT NOT NULL REFERENCES words(id),
  field TEXT NOT NULL,                     -- gloss_ko example_de example_ko gender plural level note
  old TEXT,
  new TEXT,
  why TEXT,
  source TEXT NOT NULL DEFAULT 'review',   -- review | report
  applied INTEGER NOT NULL DEFAULT 1,      -- 1 = 바꿈, 0 = 확인 필요(안 바꿈)
  reverted_at TEXT,
  at TEXT NOT NULL
);
CREATE INDEX word_changes_at ON word_changes(at);
CREATE INDEX word_changes_word_field ON word_changes(word_id, field);

CREATE TABLE word_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id TEXT NOT NULL REFERENCES words(id),
  kind TEXT NOT NULL,                      -- meaning example gender level image other
  note TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX word_reports_open ON word_reports(closed_at, created_at);

CREATE TABLE word_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,                      -- 사용자가 친 그대로(활용형일 수 있음)
  url TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued added exists rejected
  word_id TEXT,
  note TEXT
);
CREATE INDEX word_requests_status ON word_requests(status, created_at);

CREATE TABLE news_days (
  day TEXT NOT NULL,                       -- YYYY-MM-DD KST
  key TEXT NOT NULL,                       -- 기본형|품사 (sich 뺌, 대소문자 그대로)
  n INTEGER NOT NULL,                      -- 그날 나온 기사 수
  url TEXT,                                -- 그 기본형이 나온 기사 링크 1개(글은 저장 안 함)
  PRIMARY KEY (day, key)
);
CREATE INDEX news_days_key ON news_days(key, day);

CREATE TABLE word_skips (                  -- 새 단어 후보에서 뺀 기본형(Claude keep:false) — 매일 다시 묻지 않게
  key TEXT PRIMARY KEY,
  reason TEXT,
  at TEXT NOT NULL
);
```

- [ ] **Step 5: HttpError 옮기기** — `worker/http.ts` 새로 만들고 `worker/index.ts` 27~34줄(`class HttpError … const bad = …`)을 지운 뒤 import 를 더한다.

```ts
// HTTP 오류 하나: 처리기·DB 함수가 던지면 index.ts 가 {error} 와 상태 코드로 돌려준다.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const bad = (msg: string) => new HttpError(400, msg);
```

`worker/index.ts` 의 import 묶음 끝(25줄 `import { MAX_SUBS, … } from './push.ts';` 다음)에:

```ts
import { HttpError, bad } from './http.ts';
```

- [ ] **Step 6: 새 카드 고르기에 pinned** — `worker/deck.ts` 의 fresh 질의(99~101줄)를 바꾼다.

```ts
        `SELECT ${ITEM_SELECT} FROM cards c JOIN words w ON w.id = c.word_id
         WHERE c.state = 0 AND c.suspended = 0 AND (w.level IN (${levels.map(() => '?').join(',')}) OR w.pinned = 1)
         ORDER BY w.pinned DESC, w.seq LIMIT ?`,
```

- [ ] **Step 7: 통과 확인 + 기존 시험 · 형 검사**

Run: `node --test tests/words-db.test.mjs && npm test && npm run typecheck:worker`
Expected: 모두 PASS, 형 오류 0

- [ ] **Step 8: Commit**

```bash
git add migrations/0004_review_news.sql worker/http.ts worker/index.ts worker/deck.ts tests/d1.mjs tests/words-db.test.mjs
git commit -m "feat(db): 0004 검토·뉴스·신고·넣은 단어 표 + 넣은 단어는 레벨 설정을 넘어 맨 앞

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Worker 관리 함수 — 고치기(기록) · 검토 줄 · 순서 · 뉴스 · 넣기

**Files:**
- Create: `worker/words.ts`, `shared/request.ts`
- Modify: `shared/api.ts:152-162`(AdminWordsRequest), `worker/index.ts`(463~564줄 옛 adminKeys·INSERT_COLS·LEVELS·adminInsert·ADMIN_FIELDS·adminWords 를 얇은 처리기로, 길 추가)
- Test: `tests/words-db.test.mjs`

**Interfaces:**
- Consumes: `fakeD1`, `addWord`, `HttpError`, `bad`, `levelsFor`, `loadSettings`, `kstDay`, `addDays`(worker/time.ts)
- Produces (worker/words.ts):
  - `KEY_SQL: string`
  - `patchWords(db, items, now?) → Promise<{updated:number; changes:number}>`
  - `insertWords(db, items) → Promise<{inserted:number; first_id:string|null; last_id:string|null}>`
  - `wordKeys(db) → Promise<{items:{id,lemma,pos,news_rank}[]; skips:string[]}>`
  - `putSkips(db, items, now?) → Promise<{ok:true; count:number}>`
  - `reviewQueue(db, limit, now?) → Promise<ReviewQueueItem[]>`
  - `reseq(db, now?) → Promise<{hits:number; moved:number}>`
  - `putNews(db, day, items) → Promise<{ok:true; count:number}>`, `getNews(db, since) → Promise<{key,n,url}[]>`
- 주소: `GET /api/admin/keys`(모양 넓힘) · `POST /api/admin/words`(넓힘) · `POST /api/admin/words/insert`(넓힘) · `GET /api/admin/review-queue?limit=` · `POST /api/admin/reseq` · `GET /api/admin/news?since=` · `POST /api/admin/news` · `POST /api/admin/skips`

- [ ] **Step 1: 형 · 공용 규칙** — `shared/api.ts` 의 `AdminWordsRequest`(152~162줄)를 통째로 바꾸고 뒤에 `ReviewQueueItem` 을 더한다.

```ts
export interface AdminWordChange {
  field: 'gloss_ko' | 'example_de' | 'example_ko' | 'gender' | 'plural' | 'level' | 'note';
  old: string | null;
  new: string | null;
  why?: string;
  /** 1 = 바꿈, 0 = 확인 필요(안 바꿈) */
  applied: 0 | 1;
  source?: 'review' | 'report';
}
export interface AdminWordsRequest {
  items: Array<{
    id: string;
    gloss_ko?: string;
    example_de?: string;
    example_ko?: string;
    scene_en?: string;
    gloss_status?: 'generated' | 'checked' | 'mine';
    example_src?: string;
    gender?: string;
    plural?: string;
    level?: Level;
    news_rank?: number | null;
    /** 검토함 → checked_at = 지금 */
    checked?: boolean;
    /** 뜻이 바뀜 → 그림 다시 그리기(image_status = 'none') */
    image_reset?: boolean;
    /** 이 단어의 열린 신고 닫기 */
    close_reports?: boolean;
    changes?: AdminWordChange[];
  }>;
}
/** GET /api/admin/review-queue 한 줄 */
export interface ReviewQueueItem {
  id: string;
  lemma: string;
  pos: Pos;
  gender: string | null;
  plural: string | null;
  level: Level;
  gloss_ko: string | null;
  gloss_status: string;
  example_de: string | null;
  example_ko: string | null;
  checked_at: string | null;
  /** 사용자가 되돌린 칸 */
  reverted: string[];
  report: { kind: string; note: string | null } | null;
}
```

`shared/request.ts`(새):

```ts
// 「단어 넣기」 글 규칙 — 서버(worker/words.ts) · 앱(src/share.ts · AddWord) · 스크립트(scripts/words/lib.mjs)가 같이 쓴다.
// 글자로 시작, 60자 이내, 글자 · 띄어쓰기 · ' ’ . - 만(주소 · 숫자 · 이모지 안 됨)
export const REQ_TEXT = /^[\p{L}][\p{L}\s'’.-]{0,59}$/u;
```

- [ ] **Step 2: 실패하는 시험 더하기** — `tests/words-db.test.mjs` 끝에

```js
import { getNews, insertWords, patchWords, putNews, putSkips, reseq, reviewQueue, wordKeys } from '../worker/words.ts';

const NOW = new Date('2026-10-15T00:00:00Z');
const row = (db, sql) => ({ ...db.raw.prepare(sql).get() });

test('patchWords: 고침 + 기록 + checked_at + 신고 닫기 + 그림 다시', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Umzug', gloss_ko: '이동', image_status: 'ok' });
  db.raw.prepare("INSERT INTO word_reports(word_id, kind, created_at) VALUES ('w0001', 'meaning', '2026-10-14T00:00:00Z')").run();
  const r = await patchWords(db, [{
    id: 'w0001', gloss_ko: '이사', gloss_status: 'checked', checked: true, image_reset: true, close_reports: true,
    changes: [{ field: 'gloss_ko', old: '이동', new: '이사', why: '주된 뜻', applied: 1, source: 'report' }],
  }], NOW);
  assert.deepEqual(r, { updated: 1, changes: 1 });
  assert.deepEqual(row(db, "SELECT gloss_ko, gloss_status, checked_at, image_status FROM words WHERE id = 'w0001'"),
    { gloss_ko: '이사', gloss_status: 'checked', checked_at: '2026-10-15T00:00:00.000Z', image_status: 'none' });
  assert.equal(row(db, 'SELECT closed_at FROM word_reports').closed_at, '2026-10-15T00:00:00.000Z');
  assert.deepEqual(row(db, 'SELECT field, old, new, why, source, applied FROM word_changes'),
    { field: 'gloss_ko', old: '이동', new: '이사', why: '주된 뜻', source: 'report', applied: 1 });
});

test('patchWords: 예전 규칙(gloss_ko 만 → generated) · 잘못된 값 400', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', gloss_status: 'checked' });
  await patchWords(db, [{ id: 'w0001', gloss_ko: '집' }]);
  assert.equal(row(db, 'SELECT gloss_status FROM words').gloss_status, 'generated');
  await patchWords(db, [{ id: 'w0001', news_rank: 12, gender: 'das', plural: 'Häuser', level: 'B2' }]);
  assert.deepEqual(row(db, 'SELECT news_rank, gender, plural, level FROM words'), { news_rank: 12, gender: 'das', plural: 'Häuser', level: 'B2' });
  await assert.rejects(patchWords(db, [{ id: 'w0001', level: 'A1' }]), /bad level/);
  await assert.rejects(patchWords(db, [{ id: 'w0001', gender: 'm' }]), /bad gender/);
  await assert.rejects(patchWords(db, [{ id: 'w0001', news_rank: 0 }]), /bad news_rank/);
  await assert.rejects(patchWords(db, [{ id: 'w0001', changes: [{ field: 'lemma', old: 'a', new: 'b', applied: 1 }] }]), /bad change/);
});

test('reviewQueue: 신고 → 14일 안 새 카드 → 3일 안 복습 → 안 본 것 → 180일 지난 것', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Awort', seq: 1 });
  addWord(db, { id: 'w0002', lemma: 'Bwort', seq: 2, checked_at: '2026-10-14T00:00:00.000Z' });
  addWord(db, { id: 'w0003', lemma: 'Cwort', seq: 3 });
  addWord(db, { id: 'w0004', lemma: 'Dwort', seq: 4, state: 2, due: '2026-10-17T00:00:00.000Z', introduced_at: '2026-10-01T00:00:00.000Z' });
  addWord(db, { id: 'w0005', lemma: 'Ewort', seq: 5, state: 2, due: '2026-10-25T00:00:00.000Z', introduced_at: '2026-10-01T00:00:00.000Z' });
  addWord(db, { id: 'w0006', lemma: 'Fwort', seq: 6, level: 'C1' });
  addWord(db, { id: 'w0007', lemma: 'Gwort', seq: 7, level: 'C1', checked_at: '2026-03-01T00:00:00.000Z' });
  addWord(db, { id: 'w0008', lemma: 'Hwort', seq: 8, level: 'C1', checked_at: '2026-10-10T00:00:00.000Z' });
  db.raw.prepare("INSERT INTO word_reports(word_id, kind, note, created_at) VALUES ('w0006', 'example', '예문이 이상', '2026-10-14T00:00:00Z')").run();
  db.raw.prepare("INSERT INTO word_changes(word_id, field, old, new, applied, reverted_at, at) VALUES ('w0003', 'gloss_ko', 'a', 'b', 1, '2026-10-14T00:00:00Z', '2026-10-13T00:00:00Z')").run();
  const q = await reviewQueue(db, 50, NOW);
  assert.deepEqual(q.map((w) => w.id), ['w0006', 'w0001', 'w0003', 'w0004', 'w0005', 'w0007']);
  assert.deepEqual(q[0].report, { kind: 'example', note: '예문이 이상' });
  assert.deepEqual(q.find((w) => w.id === 'w0003').reverted, ['gloss_ko']);
  assert.deepEqual(q.find((w) => w.id === 'w0001').reverted, []);
  assert.equal((await reviewQueue(db, 2, NOW)).length, 2);
});

test('reseq: 배운 카드는 그대로, 넣은 단어 → B1 → B2, 같은 레벨은 최근 30일 뉴스 2회 이상 → news_rank → freq_rank', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Gelernt', seq: 1, state: 2, introduced_at: '2026-10-01T00:00:00.000Z' });
  addWord(db, { id: 'w0002', lemma: 'Alt', seq: 2, freq_rank: 10 });
  addWord(db, { id: 'w0003', lemma: 'Ermittlung', seq: 3, news_rank: 500 });
  addWord(db, { id: 'w0004', lemma: 'Vorfall', seq: 4, news_rank: 9000 });
  addWord(db, { id: 'w0005', lemma: 'Zweit', seq: 5, level: 'B2', news_rank: 1 });
  addWord(db, { id: 'w0006', lemma: 'Mein', seq: 6, level: 'C1', pinned: 1 });
  db.raw.prepare("INSERT INTO news_days(day, key, n) VALUES ('2026-10-14', 'Vorfall|noun', 2), ('2026-10-01', 'Vorfall|noun', 1), ('2026-09-01', 'Ermittlung|noun', 9)").run();
  const r = await reseq(db, NOW);
  assert.deepEqual(db.raw.prepare('SELECT id FROM words ORDER BY seq').all().map((x) => x.id), ['w0001', 'w0006', 'w0004', 'w0003', 'w0002', 'w0005']);
  assert.equal(row(db, "SELECT seq FROM words WHERE id = 'w0001'").seq, 1, '배운 카드 seq 그대로');
  assert.equal(row(db, "SELECT news_hits30 FROM words WHERE id = 'w0004'").news_hits30, 3);
  assert.equal(row(db, "SELECT news_hits30 FROM words WHERE id = 'w0003'").news_hits30, 0, '30일 넘은 기록은 안 셈');
  assert.ok(r.moved > 0);
  assert.equal((await reseq(db, NOW)).moved, 0, '두 번째는 바꿀 것 없음');
});

test('putNews: 같은 날·열쇠는 덮어씀 · 60일 지난 줄 지움 · getNews 는 기간 합 + 마지막 링크', async () => {
  const db = fakeD1();
  await putNews(db, '2026-08-01', [{ key: 'Alt|noun', n: 1, url: null }]);
  await putNews(db, '2026-10-14', [{ key: 'Vorfall|noun', n: 2, url: 'https://www.tagesschau.de/a' }]);
  await putNews(db, '2026-10-15', [{ key: 'Vorfall|noun', n: 1, url: 'https://www.ndr.de/b' }]);
  await putNews(db, '2026-10-15', [{ key: 'Vorfall|noun', n: 4, url: 'https://www.ndr.de/c' }]);
  assert.equal(row(db, "SELECT count(*) AS n FROM news_days WHERE day = '2026-08-01'").n, 0);
  assert.deepEqual(await getNews(db, '2026-10-01'), [{ key: 'Vorfall|noun', n: 6, url: 'https://www.ndr.de/c' }]);
  await assert.rejects(putNews(db, '2026-10-15', [{ key: 'x', n: 1 }]), /bad item/);
  await assert.rejects(putNews(db, '2026-10-15', [{ key: 'A|noun', n: 1, url: 'http://x' }]), /bad item/);
  await assert.rejects(putNews(db, '15.10.', []), /bad day/);
});

test('insertWords: news_rank·pinned·level_src(news|mine) · 이미 있는 (lemma,pos) 건너뜀 · 모르는 level_src 400', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', seq: 1 });
  const r = await insertWords(db, [
    { lemma: 'Ermittlung', pos: 'noun', level: 'B1', level_src: 'news', news_rank: 812, gloss_ko: '수사' },
    { lemma: 'Haus', pos: 'noun', level: 'B1', level_src: 'mine' },
    { lemma: 'beschatten', pos: 'verb', level: 'C1', level_src: 'mine', pinned: 1 },
  ]);
  assert.deepEqual(r, { inserted: 2, first_id: 'w0002', last_id: 'w0003' });
  assert.deepEqual(db.raw.prepare('SELECT id, level_src, news_rank, pinned, seq, gloss_status FROM words WHERE id > ? ORDER BY id').all('w0001').map((x) => ({ ...x })), [
    { id: 'w0002', level_src: 'news', news_rank: 812, pinned: 0, seq: 2, gloss_status: 'generated' },
    { id: 'w0003', level_src: 'mine', news_rank: null, pinned: 1, seq: 3, gloss_status: 'missing' },
  ]);
  assert.equal(row(db, "SELECT state FROM cards WHERE word_id = 'w0003'").state, 0);
  await assert.rejects(insertWords(db, [{ lemma: 'X', pos: 'noun', level: 'B1', level_src: 'kbs' }]), /bad level_src/);
});

test('wordKeys · putSkips', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', news_rank: 3 });
  await putSkips(db, [{ key: 'Bingo|noun', reason: '영화 말' }, { key: 'Bingo|noun', reason: '또' }], NOW);
  assert.deepEqual(await wordKeys(db), { items: [{ id: 'w0001', lemma: 'Haus', pos: 'noun', news_rank: 3 }], skips: ['Bingo|noun'] });
  await assert.rejects(putSkips(db, [{ key: 'nopipe' }], NOW), /bad item/);
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --test tests/words-db.test.mjs`
Expected: FAIL — `Cannot find module '../worker/words.ts'`

- [ ] **Step 4: 구현** — `worker/words.ts`

```ts
// 카드 정기 검토 · 뉴스 단어 · 신고 · 내가 넣은 단어 — DB 함수(설계 docs/superpowers/specs/2026-10-15-word-review-news-design.md).
// index.ts 처리기는 요청을 풀어 여기로 넘기기만 한다. 시험: tests/words-db.test.mjs(node:sqlite D1 흉내).
import type { AdminWordsRequest, ReviewQueueItem } from '../shared/api.ts';
import { levelsFor, loadSettings } from './deck.ts';
import { bad } from './http.ts';
import { addDays, kstDay } from './time.ts';

const DAY = 86_400_000;
const LEVELS = new Set(['B1', 'B2', 'C1']);
const GENDERS = new Set(['der', 'die', 'das']);
const GLOSS_STATUS = new Set(['generated', 'checked', 'mine']);
const LEVEL_SRC = new Set(['goethe', 'wordhoard', 'news', 'mine']);
const TEXT_FIELDS = ['gloss_ko', 'example_de', 'example_ko', 'scene_en', 'gloss_status', 'example_src', 'gender', 'plural', 'level'] as const;
const CHANGE_FIELDS = new Set(['gloss_ko', 'example_de', 'example_ko', 'gender', 'plural', 'level', 'note']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 열쇠 = 기본형|품사, 앞의 sich 는 뺀다(대소문자 그대로). scripts/words/lib.mjs 의 wordKey 와 같은 규칙 */
export const KEY_SQL = "(CASE WHEN w.lemma LIKE 'sich %' THEN substr(w.lemma, 6) ELSE w.lemma END) || '|' || w.pos";
const LEVEL_ORDER = "CASE w.level WHEN 'B1' THEN 1 WHEN 'B2' THEN 2 ELSE 3 END";
/** D1·node:sqlite 줄 → 보통 객체 */
const plain = (r: unknown) => ({ ...(r as Record<string, unknown>) });
const str = (x: unknown, max: number) => (x == null ? null : String(x).slice(0, max));

// ---------- 고치기(기록 포함) ----------

/** 칸 고치기. 검토(review.mjs) · 글 채우기(daily.mjs) · 순위(news.mjs)가 같이 쓴다. 준 칸만 바꾼다. */
export async function patchWords(db: D1Database, items: AdminWordsRequest['items'] | undefined, now = new Date()) {
  if (!Array.isArray(items) || items.length > 500) throw bad('bad_request');
  const at = now.toISOString();
  const stmts: D1PreparedStatement[] = [];
  const wordStmt = new Set<number>();
  let changes = 0;
  for (const it of items) {
    if (typeof it?.id !== 'string') throw bad('bad_item');
    const sets: string[] = [];
    const binds: unknown[] = [];
    const put = (k: string, v: unknown) => {
      sets.push(`${k} = ?`);
      binds.push(v);
    };
    for (const k of TEXT_FIELDS) {
      const v = it[k];
      if (v === undefined) continue;
      if (typeof v !== 'string') throw bad(`${k} must be string`);
      if (k === 'gloss_status' && !GLOSS_STATUS.has(v)) throw bad('bad gloss_status');
      if (k === 'gender' && v !== '' && !GENDERS.has(v)) throw bad('bad gender');
      if (k === 'level' && !LEVELS.has(v)) throw bad('bad level');
      put(k, (k === 'gender' || k === 'plural') && v === '' ? null : v);
    }
    // 예전 규칙(daily.mjs): 뜻이 오면 generated, 예문이 오면 gen
    if (it.gloss_ko !== undefined && it.gloss_status === undefined) put('gloss_status', 'generated');
    if (it.example_de !== undefined && it.example_src === undefined) put('example_src', 'gen');
    if (it.news_rank !== undefined) {
      if (it.news_rank !== null && !(Number.isInteger(it.news_rank) && it.news_rank > 0)) throw bad('bad news_rank');
      put('news_rank', it.news_rank);
    }
    if (it.checked) put('checked_at', at);
    if (it.image_reset) sets.push("image_status = 'none'");
    if (sets.length) {
      wordStmt.add(stmts.length);
      stmts.push(db.prepare(`UPDATE words SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, it.id));
    }
    if (it.close_reports) stmts.push(db.prepare('UPDATE word_reports SET closed_at = ? WHERE word_id = ? AND closed_at IS NULL').bind(at, it.id));
    for (const c of it.changes ?? []) {
      if (!c || !CHANGE_FIELDS.has(c.field) || (c.applied !== 0 && c.applied !== 1)) throw bad('bad change');
      stmts.push(
        db.prepare('INSERT INTO word_changes(word_id, field, old, new, why, source, applied, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(it.id, c.field, str(c.old, 300), str(c.new, 300), str(c.why, 300), c.source === 'report' ? 'report' : 'review', c.applied, at),
      );
      changes++;
    }
  }
  const results = stmts.length ? await db.batch(stmts) : [];
  const updated = results.reduce((n, r, i) => n + (wordStmt.has(i) ? (r.meta.changes ?? 0) : 0), 0);
  return { updated, changes };
}

// ---------- 넣기 · 열쇠 · 뺀 후보 ----------

const INSERT_COLS = ['lemma', 'pos', 'gender', 'plural', 'ipa', 'level', 'level_src', 'gloss_en', 'gloss_ko', 'gloss_status',
  'example_de', 'example_ko', 'example_src', 'scene_en', 'freq_rank', 'news_rank', 'pinned'] as const;

/** 새 단어 넣기: id·seq 는 지금 끝 번호에서 이어 매기고 카드(state 0)도 같이 만든다. 같은 (lemma,pos) 는 건너뜀. */
export async function insertWords(db: D1Database, items: Array<Record<string, unknown>> | undefined) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) throw bad('items 1..200');
  for (const it of items) {
    if (typeof it.lemma !== 'string' || !it.lemma.trim() || typeof it.pos !== 'string') throw bad('lemma/pos required');
    if (!LEVELS.has(String(it.level))) throw bad('level must be B1|B2|C1');
    if (!LEVEL_SRC.has(String(it.level_src))) throw bad('bad level_src');
  }
  const top = await db.prepare('SELECT max(CAST(substr(id, 2) AS INTEGER)) AS n, max(seq) AS s FROM words').first<{ n: number | null; s: number | null }>();
  let n = top?.n ?? 0;
  let seq = top?.s ?? 0;
  const have = new Set((await db.prepare('SELECT lemma, pos FROM words').all<{ lemma: string; pos: string }>()).results.map((r) => `${r.lemma}|${r.pos}`));
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  let first: string | null = null;
  let last: string | null = null;
  for (const it of items) {
    const k = `${it.lemma}|${it.pos}`;
    if (have.has(k)) continue;
    have.add(k);
    n += 1;
    seq += 1;
    const id = `w${String(n).padStart(4, '0')}`;
    first ??= id;
    last = id;
    const vals: unknown[] = INSERT_COLS.map((c) => (it[c] === undefined || it[c] === '' ? null : it[c]));
    vals[INSERT_COLS.indexOf('gloss_status')] ??= it.gloss_ko ? 'generated' : 'missing';
    vals[INSERT_COLS.indexOf('pinned')] = it.pinned ? 1 : 0;
    stmts.push(
      db.prepare(`INSERT INTO words(id, seq, image_status, ${INSERT_COLS.join(', ')}) VALUES (?, ?, 'none', ${INSERT_COLS.map(() => '?').join(', ')})`).bind(id, seq, ...vals),
      db.prepare('INSERT INTO cards(word_id, state, due) VALUES (?, 0, ?)').bind(id, now),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return { inserted: stmts.length / 2, first_id: first, last_id: last };
}

/** 정기 작업용: 있는 단어 열쇠(+ 뉴스 순위) · 후보에서 뺀 기본형 */
export async function wordKeys(db: D1Database) {
  const [w, s] = await db.batch([db.prepare('SELECT id, lemma, pos, news_rank FROM words ORDER BY id'), db.prepare('SELECT key FROM word_skips ORDER BY key')]);
  return { items: w.results.map(plain), skips: (s.results as Array<{ key: string }>).map((r) => r.key) };
}

export async function putSkips(db: D1Database, items: Array<{ key?: unknown; reason?: unknown }> | undefined, now = new Date()) {
  if (!Array.isArray(items) || items.length > 400) throw bad('bad_request');
  const stmts = items.map((it) => {
    if (typeof it?.key !== 'string' || !/^[^|]{1,60}\|[a-z]+$/.test(it.key)) throw bad('bad item');
    return db.prepare('INSERT INTO word_skips(key, reason, at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING').bind(it.key, str(it.reason, 100), now.toISOString());
  });
  if (stmts.length) await db.batch(stmts);
  return { ok: true as const, count: stmts.length };
}

// ---------- 검토할 줄 ----------

const REVIEW_COLS = `w.id, w.lemma, w.pos, w.gender, w.plural, w.level, w.gloss_ko, w.gloss_status, w.example_de, w.example_ko, w.checked_at,
  (SELECT group_concat(DISTINCT x.field) FROM word_changes x WHERE x.word_id = w.id AND x.reverted_at IS NOT NULL) AS reverted`;

/** 검토할 단어: 열린 신고 → 앞으로 14일 안 새 카드 → 3일 안 복습 → 안 본 것(seq) → 180일 지난 것. 최근 검토는 빠진다. */
export async function reviewQueue(db: D1Database, limit: number, now = new Date()): Promise<ReviewQueueItem[]> {
  const s = await loadSettings(db);
  const lv = levelsFor(s.level);
  const inLevel = `(w.level IN (${lv.map(() => '?').join(', ')}) OR w.pinned = 1)`;
  const stale = new Date(now.getTime() - 180 * DAY).toISOString();
  const soon = new Date(now.getTime() + 3 * DAY).toISOString();
  const notFresh = '(w.checked_at IS NULL OR w.checked_at < ?)';
  const parts = await db.batch([
    db.prepare(`SELECT ${REVIEW_COLS}, r.kind AS report_kind, r.note AS report_note
      FROM word_reports r JOIN words w ON w.id = r.word_id WHERE r.closed_at IS NULL ORDER BY r.created_at LIMIT ?`).bind(limit),
    db.prepare(`SELECT ${REVIEW_COLS} FROM (
        SELECT w.* FROM words w JOIN cards c ON c.word_id = w.id
        WHERE c.state = 0 AND c.suspended = 0 AND ${inLevel} ORDER BY w.pinned DESC, w.seq LIMIT ?
      ) w WHERE ${notFresh}`).bind(...lv, 14 * s.new_per_day, stale),
    db.prepare(`SELECT ${REVIEW_COLS} FROM words w JOIN cards c ON c.word_id = w.id
      WHERE c.state IN (1, 2, 3) AND c.suspended = 0 AND c.due < ? AND ${notFresh} ORDER BY c.due LIMIT ?`).bind(soon, stale, limit),
    db.prepare(`SELECT ${REVIEW_COLS} FROM words w WHERE w.checked_at IS NULL ORDER BY w.seq LIMIT ?`).bind(limit),
    db.prepare(`SELECT ${REVIEW_COLS} FROM words w WHERE w.checked_at < ? ORDER BY w.checked_at LIMIT ?`).bind(stale, limit),
  ]);
  const out: ReviewQueueItem[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const r of part.results as Array<Record<string, unknown>>) {
      if (out.length >= limit) return out;
      const id = String(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const t = (k: string) => (r[k] == null ? null : String(r[k]));
      out.push({
        id,
        lemma: String(r.lemma),
        pos: r.pos as ReviewQueueItem['pos'],
        gender: t('gender'),
        plural: t('plural'),
        level: r.level as ReviewQueueItem['level'],
        gloss_ko: t('gloss_ko'),
        gloss_status: String(r.gloss_status),
        example_de: t('example_de'),
        example_ko: t('example_ko'),
        checked_at: t('checked_at'),
        reverted: r.reverted ? String(r.reverted).split(',') : [],
        report: r.report_kind ? { kind: String(r.report_kind), note: t('report_note') } : null,
      });
    }
  }
  return out;
}

// ---------- 학습 순서 ----------

/** 최근 30일 뉴스 수를 다시 세고, 아직 안 배운 카드의 seq 를 다시 매긴다. 배운 카드는 건드리지 않는다. */
export async function reseq(db: D1Database, now = new Date()) {
  const since = addDays(kstDay(now), -29); // 오늘 포함 30일
  const [h, m] = await db.batch([
    db.prepare(`UPDATE words SET news_hits30 = x.h FROM (
        SELECT w.id, coalesce((SELECT sum(d.n) FROM news_days d WHERE d.key = ${KEY_SQL} AND d.day >= ?), 0) AS h FROM words w
      ) x WHERE words.id = x.id AND words.news_hits30 != x.h`).bind(since),
    db.prepare(`UPDATE words SET seq = x.rn FROM (
        SELECT w.id,
          (SELECT coalesce(max(w2.seq), 0) FROM words w2 JOIN cards c2 ON c2.word_id = w2.id WHERE c2.state != 0 OR c2.introduced_at IS NOT NULL)
          + row_number() OVER (ORDER BY w.pinned DESC, ${LEVEL_ORDER}, (w.news_hits30 >= 2) DESC,
              w.news_rank IS NULL, w.news_rank, w.freq_rank IS NULL, w.freq_rank, w.lemma) AS rn
        FROM words w JOIN cards c ON c.word_id = w.id WHERE c.state = 0 AND c.introduced_at IS NULL
      ) x WHERE words.id = x.id AND words.seq != x.rn`),
  ]);
  return { hits: h.meta.changes ?? 0, moved: m.meta.changes ?? 0 };
}

// ---------- 뉴스 수 ----------

/** 그날 기본형별 기사 수(같은 날·열쇠면 덮어씀) + 60일 지난 줄 지우기. 글은 받지 않는다. */
export async function putNews(db: D1Database, day: unknown, items: Array<{ key?: unknown; n?: unknown; url?: unknown }> | undefined) {
  if (typeof day !== 'string' || !DAY_RE.test(day)) throw bad('bad day');
  if (!Array.isArray(items) || items.length > 400) throw bad('bad_request');
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    const okUrl = it?.url == null || (typeof it.url === 'string' && it.url.length <= 500 && it.url.startsWith('https://'));
    if (typeof it?.key !== 'string' || !/^[^|]{1,60}\|[a-z]+$/.test(it.key) || !Number.isInteger(it.n) || (it.n as number) < 1 || !okUrl) throw bad('bad item');
    stmts.push(
      db.prepare('INSERT INTO news_days(day, key, n, url) VALUES (?, ?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET n = excluded.n, url = excluded.url')
        .bind(day, it.key, it.n, (it.url as string | null | undefined) ?? null),
    );
  }
  stmts.push(db.prepare('DELETE FROM news_days WHERE day < ?').bind(addDays(day, -60)));
  await db.batch(stmts);
  return { ok: true as const, count: items.length };
}

/** since 부터 기본형별 합 + 가장 최근 링크 */
export async function getNews(db: D1Database, since: string) {
  if (!DAY_RE.test(since)) throw bad('bad since');
  const r = await db.prepare(`SELECT d.key, sum(d.n) AS n,
      (SELECT d2.url FROM news_days d2 WHERE d2.key = d.key AND d2.url IS NOT NULL ORDER BY d2.day DESC LIMIT 1) AS url
    FROM news_days d WHERE d.day >= ? GROUP BY d.key ORDER BY n DESC, d.key`).bind(since).all<{ key: string; n: number; url: string | null }>();
  return r.results.map((x) => ({ key: x.key, n: Number(x.n), url: x.url ?? null }));
}
```

- [ ] **Step 5: index.ts 처리기 바꾸기** — 463~564줄(`/** 정기 업데이트(scripts/words/update.mjs)용 …` 부터 `adminWords` 끝 `};` 까지)에서 `adminKeys` · `INSERT_COLS` · `LEVELS` · `adminInsert` · `ADMIN_FIELDS` · `adminWords` 를 지우고(`runway` 는 남김) 그 자리에:

```ts
// ---------- 단어 관리(worker/words.ts) ----------

const adminKeys: Handler = async ({ env }) => json(await wordKeys(env.DB));
const adminInsert: Handler = async ({ req, env }) =>
  json(await insertWords(env.DB, (await readJson<{ items?: Array<Record<string, unknown>> }>(req))?.items));
/** 단어 칸 고치기 + 고침 기록(scripts/words/review.mjs) · 글 채우기(daily.mjs) */
const adminWords: Handler = async ({ req, env }) => json(await patchWords(env.DB, (await readJson<AdminWordsRequest>(req))?.items));
const adminReviewQueue: Handler = async ({ env, url }) =>
  json({ items: await reviewQueue(env.DB, clamp(intParam(url.searchParams.get('limit'), 250), 1, 500)) });
const adminReseq: Handler = async ({ env }) => json(await reseq(env.DB));
const adminNewsGet: Handler = async ({ env, url }) => json({ items: await getNews(env.DB, url.searchParams.get('since') ?? '') });
const adminNewsPut: Handler = async ({ req, env }) => {
  const b = await readJson<{ day?: unknown; items?: Array<{ key?: unknown; n?: unknown; url?: unknown }> }>(req);
  return json(await putNews(env.DB, b?.day, b?.items));
};
const adminSkips: Handler = async ({ req, env }) =>
  json(await putSkips(env.DB, (await readJson<{ items?: Array<{ key?: unknown; reason?: unknown }> }>(req))?.items));
```

import 에 더하기:

```ts
import { getNews, insertWords, patchWords, putNews, putSkips, reseq, reviewQueue, wordKeys } from './words.ts';
```

`routes` 배열에서 `['GET', /^\/api\/admin\/keys$/, adminKeys],` 줄 앞에 더하기(나머지 둘은 그대로):

```ts
  ['GET', /^\/api\/admin\/review-queue$/, adminReviewQueue],
  ['POST', /^\/api\/admin\/reseq$/, adminReseq],
  ['GET', /^\/api\/admin\/news$/, adminNewsGet],
  ['POST', /^\/api\/admin\/news$/, adminNewsPut],
  ['POST', /^\/api\/admin\/skips$/, adminSkips],
```

`scripts/words/update.mjs` 는 200개씩 넣으므로 상한 500 → 200 영향 없음(`INSERT_BATCH = 200`).

- [ ] **Step 6: 통과 확인**

Run: `node --test tests/words-db.test.mjs && npm test && npm run typecheck:worker`
Expected: 모두 PASS, 형 오류 0

- [ ] **Step 7: Commit**

```bash
git add shared/api.ts shared/request.ts worker/words.ts worker/index.ts tests/words-db.test.mjs
git commit -m "feat(worker): 단어 고치기 기록 · 검토 줄 · 뉴스 수 · 학습 순서 다시 매기기

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Worker 앱 함수 — 신고 · 단어 넣기 · 고친 카드 · 주간 수

**Files:**
- Modify: `worker/words.ts`(끝에 덧붙임), `worker/index.ts`(처리기·길), `shared/api.ts`(형)
- Test: `tests/words-db.test.mjs`

**Interfaces:**
- Consumes: Task 2 의 `plain`·`str`·`DAY`(같은 파일), `REQ_TEXT`, `HttpError`, `bad`
- Produces:
  - `addReport(db, wordId, body, now?) → {ok:true; id:number}`
  - `addRequest(db, body, now?) → {ok:true; id:number; duplicate:boolean}`
  - `listRequests(db, status?, limit) → WordRequestItem[]`
  - `settleRequest(db, id, body) → {ok:true}`
  - `listChanges(db, limit) → ChangeItem[]`
  - `revertChange(db, id, now?) → {ok:true}`
  - `reviewStats(db, now?) → ReviewStats`
- 주소: 앱 `POST /api/words/:id/report` · `GET|POST /api/requests` · `GET /api/changes` · `POST /api/changes/:id/revert`; 관리 `GET /api/admin/requests?status=` · `POST /api/admin/requests/:id` · `GET /api/admin/review-stats`

- [ ] **Step 1: 형** — `shared/api.ts` 끝에

```ts
export type ReportKind = 'meaning' | 'example' | 'gender' | 'level' | 'image' | 'other';
export interface ReportRequest {
  kind: ReportKind;
  note?: string;
}
export type RequestStatus = 'queued' | 'added' | 'exists' | 'rejected';
export interface WordRequestItem {
  id: number;
  text: string;
  url: string | null;
  created_at: string;
  status: RequestStatus;
  word_id: string | null;
  /** 카드가 된 단어의 표제어 */
  lemma: string | null;
  note: string | null;
}
export interface WordRequestsResponse {
  items: WordRequestItem[];
}
export interface ChangeItem {
  id: number;
  word_id: string;
  lemma: string;
  field: string;
  old: string | null;
  new: string | null;
  why: string | null;
  source: 'review' | 'report';
  applied: 0 | 1;
  reverted_at: string | null;
  at: string;
}
export interface ChangesResponse {
  items: ChangeItem[];
}
export interface ReviewStats {
  total: number;
  checked: number;
  week: { applied: number; flagged: number; news: number; mine: number; requests: number };
}
```

- [ ] **Step 2: 실패하는 시험 더하기** — `tests/words-db.test.mjs` 끝에

```js
import { addReport, addRequest, listChanges, listRequests, revertChange, reviewStats, settleRequest } from '../worker/words.ts';

test('addReport: 종류 검사 · 없는 단어 404 · 메모 200자로 자름', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus' });
  const r = await addReport(db, 'w0001', { kind: 'example', note: 'x'.repeat(300) }, NOW);
  assert.equal(r.ok, true);
  assert.equal(row(db, 'SELECT length(note) AS n FROM word_reports').n, 200);
  await assert.rejects(addReport(db, 'w0001', { kind: 'spam' }, NOW), /bad kind/);
  await assert.rejects(addReport(db, 'w9999', { kind: 'meaning' }, NOW), (e) => e.status === 404);
});

test('addRequest: 글자 단어만 · 주소·이모지·61자·빈 값 400 · 같은 대기 글은 같은 번호', async () => {
  const db = fakeD1();
  const a = await addRequest(db, { text: '  Ermittlung ', url: 'https://www.dw.com/de/x' }, NOW);
  assert.deepEqual(a, { ok: true, id: 1, duplicate: false });
  assert.deepEqual(await addRequest(db, { text: 'Ermittlung' }, NOW), { ok: true, id: 1, duplicate: true });
  assert.equal((await addRequest(db, { text: 'die Daumen drücken' }, NOW)).id, 2);
  for (const text of ['', 'https://www.dw.com/de/x', 'Ermittlung🙂', 'a'.repeat(61), '123', 42])
    await assert.rejects(addRequest(db, { text }, NOW), /bad_text/, String(text));
  await assert.rejects(addRequest(db, { text: 'Haus', url: 'http://x' }, NOW), /bad_url/);
  await assert.rejects(addRequest(db, { text: 'Haus', url: 'https://' + 'x'.repeat(600) }, NOW), /bad_url/);
});

test('settleRequest: exists 면 그 단어 pinned · 두 번째는 409 · listRequests 모양', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Ermittlung' });
  await addRequest(db, { text: 'ermittlung' }, NOW);
  await addRequest(db, { text: 'Quatschwort' }, NOW);
  assert.deepEqual((await listRequests(db, 'queued', 50)).map((r) => r.text), ['ermittlung', 'Quatschwort']);
  await settleRequest(db, 1, { status: 'exists', word_id: 'w0001' });
  await settleRequest(db, 2, { status: 'rejected', note: '독일어 아님' });
  assert.equal(row(db, "SELECT pinned FROM words WHERE id = 'w0001'").pinned, 1);
  await assert.rejects(settleRequest(db, 1, { status: 'added', word_id: 'w0001' }), (e) => e.status === 409);
  await assert.rejects(settleRequest(db, 2, { status: 'queued' }), /bad status/);
  await assert.rejects(settleRequest(db, 2, { status: 'added' }), /word_id required/);
  const list = await listRequests(db, undefined, 10);
  assert.deepEqual(list[0], { id: 2, text: 'Quatschwort', url: null, created_at: '2026-10-15T00:00:00.000Z', status: 'rejected', word_id: null, lemma: null, note: '독일어 아님' });
  assert.equal(list[1].lemma, 'Ermittlung');
});

test('revertChange: 원래 값으로 · 그 뒤 바뀌었으면 409 · 두 번 409 · 확인 필요는 409', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Umzug', gloss_ko: '이사' });
  await patchWords(db, [{ id: 'w0001', gloss_ko: '이사', changes: [
    { field: 'gloss_ko', old: '이동', new: '이사', why: '주된 뜻', applied: 1 },
    { field: 'level', old: 'B1', new: 'B2', why: 'DAFlex 다름', applied: 0 },
  ] }], NOW);
  const [flag, fix] = await listChanges(db, 10);
  assert.equal(fix.field, 'gloss_ko');
  assert.equal(fix.lemma, 'Umzug');
  await assert.rejects(revertChange(db, flag.id, NOW), (e) => e.status === 409);
  await revertChange(db, fix.id, NOW);
  assert.equal(row(db, 'SELECT gloss_ko FROM words').gloss_ko, '이동');
  await assert.rejects(revertChange(db, fix.id, NOW), (e) => e.status === 409);
  // 다시 고쳐진 뒤 다른 값으로 또 바뀐 경우
  await patchWords(db, [{ id: 'w0001', gloss_ko: '이사', changes: [{ field: 'gloss_ko', old: '이동', new: '이사', applied: 1 }] }], NOW);
  await patchWords(db, [{ id: 'w0001', gloss_ko: '이전' }], NOW);
  const again = (await listChanges(db, 10))[0];
  await assert.rejects(revertChange(db, again.id, NOW), (e) => e.status === 409 && /changed_since/.test(e.message));
  await assert.rejects(revertChange(db, 999, NOW), (e) => e.status === 404);
});

test('reviewStats: 검토 수 · 이번 주 고침·확인 필요·새 단어', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', checked_at: '2026-10-14T00:00:00.000Z' });
  await insertWords(db, [{ lemma: 'Vorfall', pos: 'noun', level: 'B1', level_src: 'news' }]);
  await patchWords(db, [{ id: 'w0001', changes: [{ field: 'level', old: 'B1', new: 'B2', applied: 0 }] }], new Date());
  await addRequest(db, { text: 'Ermittlung' }, new Date());
  const s = await reviewStats(db, new Date());
  assert.deepEqual(s, { total: 2, checked: 1, week: { applied: 0, flagged: 1, news: 1, mine: 0, requests: 1 } });
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --test tests/words-db.test.mjs`
Expected: FAIL — `does not provide an export named 'addReport'`

- [ ] **Step 4: 구현** — `worker/words.ts` 머리 import 네 줄을 통째로 바꾸고 끝에 덧붙인다.

머리(import 네 줄 교체):

```ts
import type { AdminWordsRequest, ChangeItem, ReviewQueueItem, ReviewStats, WordRequestItem } from '../shared/api.ts';
import { REQ_TEXT } from '../shared/request.ts';
import { levelsFor, loadSettings } from './deck.ts';
import { HttpError, bad } from './http.ts';
import { addDays, kstDay } from './time.ts';
```

끝에:

```ts
// ---------- 앱: 신고 · 단어 넣기 · 고친 카드 ----------

const REPORT_KINDS = new Set(['meaning', 'example', 'gender', 'level', 'image', 'other']);
const REQUEST_DONE = new Set(['added', 'exists', 'rejected']);
const REVERTIBLE = new Set(['gloss_ko', 'example_de', 'example_ko', 'gender', 'plural', 'level']);

/** 「이상해요」 — 다음 검토 때 맨 먼저 본다 */
export async function addReport(db: D1Database, wordId: string, body: { kind?: unknown; note?: unknown } | null, now = new Date()) {
  const kind = String(body?.kind ?? '');
  if (!REPORT_KINDS.has(kind)) throw bad('bad kind');
  const note = body?.note == null ? null : String(body.note).trim().slice(0, 200) || null;
  if (!(await db.prepare('SELECT id FROM words WHERE id = ?').bind(wordId).first())) throw new HttpError(404, 'not_found');
  const r = await db.prepare('INSERT INTO word_reports(word_id, kind, note, created_at) VALUES (?, ?, ?, ?)').bind(wordId, kind, note, now.toISOString()).run();
  return { ok: true as const, id: Number(r.meta.last_row_id) };
}

/** 「단어 넣기」 — 다음 새벽 작업(news.mjs)이 카드로 만든다. 같은 글이 대기 중이면 그 번호 */
export async function addRequest(db: D1Database, body: { text?: unknown; url?: unknown } | null, now = new Date()) {
  const text = typeof body?.text === 'string' ? body.text.trim().replace(/\s+/g, ' ') : '';
  if (!REQ_TEXT.test(text)) throw bad('bad_text');
  let url: string | null = null;
  if (body?.url != null && body.url !== '') {
    if (typeof body.url !== 'string' || body.url.length > 500 || !body.url.startsWith('https://')) throw bad('bad_url');
    try {
      new URL(body.url);
    } catch {
      throw bad('bad_url');
    }
    url = body.url;
  }
  const dup = await db.prepare("SELECT id FROM word_requests WHERE status = 'queued' AND text = ?").bind(text).first<{ id: number }>();
  if (dup) return { ok: true as const, id: Number(dup.id), duplicate: true };
  const r = await db.prepare('INSERT INTO word_requests(text, url, created_at) VALUES (?, ?, ?)').bind(text, url, now.toISOString()).run();
  return { ok: true as const, id: Number(r.meta.last_row_id), duplicate: false };
}

/** status 를 주면 그 상태만 오래된 순(작업용), 안 주면 최근 순(앱) */
export async function listRequests(db: D1Database, status: string | undefined, limit: number): Promise<WordRequestItem[]> {
  const r = await db.prepare(`SELECT q.id, q.text, q.url, q.created_at, q.status, q.word_id, w.lemma, q.note
      FROM word_requests q LEFT JOIN words w ON w.id = q.word_id
      ${status ? 'WHERE q.status = ?' : ''} ORDER BY q.id ${status ? 'ASC' : 'DESC'} LIMIT ?`)
    .bind(...(status ? [status, limit] : [limit]))
    .all();
  return r.results.map((x) => plain(x) as unknown as WordRequestItem);
}

/** 넣은 단어 처리 결과. added·exists 면 그 단어를 새 카드 맨 앞(pinned)으로 */
export async function settleRequest(db: D1Database, id: number, body: { status?: unknown; word_id?: unknown; note?: unknown } | null) {
  const status = String(body?.status ?? '');
  if (!REQUEST_DONE.has(status)) throw bad('bad status');
  const wordId = typeof body?.word_id === 'string' ? body.word_id : null;
  if (status !== 'rejected' && !wordId) throw bad('word_id required');
  const cur = await db.prepare('SELECT status FROM word_requests WHERE id = ?').bind(id).first<{ status: string }>();
  if (!cur) throw new HttpError(404, 'not_found');
  if (cur.status !== 'queued') throw new HttpError(409, 'not_queued');
  const stmts = [db.prepare('UPDATE word_requests SET status = ?, word_id = ?, note = ? WHERE id = ?').bind(status, wordId, str(body?.note, 100), id)];
  if (wordId) stmts.push(db.prepare('UPDATE words SET pinned = 1 WHERE id = ?').bind(wordId));
  await db.batch(stmts);
  return { ok: true as const };
}

/** 고친 카드(최근 순) — 「확인 필요」(applied 0)도 같이 */
export async function listChanges(db: D1Database, limit: number): Promise<ChangeItem[]> {
  const r = await db.prepare(`SELECT x.id, x.word_id, w.lemma, x.field, x.old, x.new, x.why, x.source, x.applied, x.reverted_at, x.at
      FROM word_changes x JOIN words w ON w.id = x.word_id ORDER BY x.id DESC LIMIT ?`).bind(limit).all();
  return r.results.map((x) => plain(x) as unknown as ChangeItem);
}

/** 되돌리기: 지금 값이 그 고침의 새 값일 때만(그 뒤 또 바뀌었으면 409) */
export async function revertChange(db: D1Database, id: number, now = new Date()) {
  const c = await db.prepare('SELECT word_id, field, old, new, applied, reverted_at FROM word_changes WHERE id = ?').bind(id)
    .first<{ word_id: string; field: string; old: string | null; new: string | null; applied: number; reverted_at: string | null }>();
  if (!c) throw new HttpError(404, 'not_found');
  if (!c.applied || c.reverted_at || !REVERTIBLE.has(c.field)) throw new HttpError(409, 'not_revertible');
  // c.field 는 REVERTIBLE 안의 이름이라 SQL 에 넣어도 안전
  const cur = await db.prepare(`SELECT ${c.field} AS v FROM words WHERE id = ?`).bind(c.word_id).first<{ v: string | null }>();
  if ((cur?.v ?? null) !== (c.new ?? null)) throw new HttpError(409, 'changed_since');
  await db.batch([
    db.prepare(`UPDATE words SET ${c.field} = ? WHERE id = ?`).bind(c.old, c.word_id),
    db.prepare('UPDATE word_changes SET reverted_at = ? WHERE id = ?').bind(now.toISOString(), id),
  ]);
  return { ok: true as const };
}

/** 주간 요약(일요일 디스코드) */
export async function reviewStats(db: D1Database, now = new Date()): Promise<ReviewStats> {
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const [t, c, ch, add, req] = await db.batch([
    db.prepare('SELECT count(*) AS n FROM words'),
    db.prepare('SELECT count(*) AS n FROM words WHERE checked_at IS NOT NULL'),
    db.prepare('SELECT applied, count(*) AS n FROM word_changes WHERE at >= ? GROUP BY applied').bind(since),
    // words.created_at 은 datetime('now') 꼴(공백) → ISO 를 datetime() 으로 맞춰 비교
    db.prepare("SELECT level_src, count(*) AS n FROM words WHERE created_at >= datetime(?) AND level_src IN ('news', 'mine') GROUP BY level_src").bind(since),
    db.prepare('SELECT count(*) AS n FROM word_requests WHERE created_at >= ?').bind(since),
  ]);
  const n = (r: D1Result) => Number((r.results[0] as { n: number }).n);
  const by = (r: D1Result, k: string) => Object.fromEntries((r.results as Array<Record<string, unknown>>).map((x) => [String(x[k]), Number(x.n)]));
  const chg = by(ch, 'applied');
  const ad = by(add, 'level_src');
  return { total: n(t), checked: n(c), week: { applied: chg['1'] ?? 0, flagged: chg['0'] ?? 0, news: ad.news ?? 0, mine: ad.mine ?? 0, requests: n(req) } };
}
```

- [ ] **Step 5: index.ts 처리기·길** — Task 2 의 처리기 묶음 뒤에:

```ts
const adminRequests: Handler = async ({ env, url }) =>
  json({ items: await listRequests(env.DB, url.searchParams.get('status') ?? undefined, 50) });
const adminSettle: Handler = async ({ req, env, params: [id] }) =>
  json(await settleRequest(env.DB, Number(id), await readJson<Record<string, unknown>>(req)));
const adminReviewStats: Handler = async ({ env }) => json(await reviewStats(env.DB));
const postReport: Handler = async ({ req, env, params: [id] }) => json(await addReport(env.DB, id, await readJson<Record<string, unknown>>(req)));
const getRequests: Handler = async ({ env }) => json({ items: await listRequests(env.DB, undefined, 10) });
const postRequest: Handler = async ({ req, env }) => json(await addRequest(env.DB, await readJson<Record<string, unknown>>(req)));
const getChanges: Handler = async ({ env }) => json({ items: await listChanges(env.DB, 100) });
const postRevert: Handler = async ({ env, params: [id] }) => json(await revertChange(env.DB, Number(id)));
```

import 줄을 넓힌다:

```ts
import {
  addReport, addRequest, getNews, insertWords, listChanges, listRequests, patchWords, putNews, putSkips,
  reseq, revertChange, reviewQueue, reviewStats, settleRequest, wordKeys,
} from './words.ts';
```

`routes` 에(앱 길은 `['GET', /^\/api\/word\/([\w-]+)$/, wordDetail],` 다음, 관리 길은 Task 2 묶음 다음):

```ts
  ['POST', /^\/api\/words\/([\w-]+)\/report$/, postReport],
  ['GET', /^\/api\/requests$/, getRequests],
  ['POST', /^\/api\/requests$/, postRequest],
  ['GET', /^\/api\/changes$/, getChanges],
  ['POST', /^\/api\/changes\/(\d+)\/revert$/, postRevert],
```

```ts
  ['GET', /^\/api\/admin\/requests$/, adminRequests],
  ['POST', /^\/api\/admin\/requests\/(\d+)$/, adminSettle],
  ['GET', /^\/api\/admin\/review-stats$/, adminReviewStats],
```

- [ ] **Step 6: 통과 확인**

Run: `node --test tests/words-db.test.mjs && npm test && npm run typecheck:worker`
Expected: 모두 PASS

- [ ] **Step 7: Commit**

```bash
git add shared/api.ts worker/words.ts worker/index.ts tests/words-db.test.mjs
git commit -m "feat(worker): 카드 신고 · 단어 넣기 · 고친 카드 되돌리기 · 주간 수

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 순수 함수 `scripts/words/lib.mjs` (+ update.mjs 가 같이 쓰게)

**Files:**
- Create: `scripts/words/lib.mjs`, `tests/words-lib.test.mjs`
- Modify: `scripts/words/update.mjs:233-261`(writeContent)

**Interfaces:**
- Consumes: `findWord`(shared/cloze.ts), `REQ_TEXT`(shared/request.ts)
- Produces (모두 export):
  - `own(obj, key)`, `wordKey(lemma, pos) → string`, `tokens(text) → string[]`, `lemmatize(tok, index, first?) → string[]`
  - `countNews(articles: {title,text,url}[], index) → Map<key, {n, url}>`
  - `parseTagesschau(json) → {title,text,url}[]`, `parseRss(xml) → {title,text,url}[]`
  - `cefr3(d) → 'B1'|'B2'|'C1'|null`
  - `pickCandidates({index, have:Set<lowerKey>, skips:Set<key>, hits:Map<key,{n,url}>, max?, rankMax?}) → {key,lemma,pos,rank,hits,level}[]`
  - `contentPrompt(list, source?) → string`, `acceptContent(arr, list) → {key,keep,…}[]`
  - `requestPrompt(list:{id,text}[]) → string`, `acceptRequests(arr, ids) → Map<id, {keep,…}>`
  - `exampleHasWord(de, w, index) → boolean`, `factsFor(w, index) → {genders, plural, daflexRaw, daflex, hasForm}`
  - `reviewPrompt(items, factsOf) → string`, `acceptVerdicts(arr, ids) → Map<id, {ok, fix?, meaning_changed?, why?}>`
  - `decide(w, facts, v, reverted?) → {patch, changes, meaningChanged}`
  - `summaryText(stats: ReviewStats) → string`
- 색인 모양(Task 5 가 만든다): `{ month, built, src, forms: {활용형: [열쇠]}, facts: {열쇠: {g?: string[], pl?: string|null, en: string|null}}, daflex: {소문자 낱말: 'A1'…'C2'}, leipzig: {열쇠: 순위} }`

- [ ] **Step 1: 실패하는 시험** — `tests/words-lib.test.mjs`

```js
// scripts/words/lib.mjs 순수 함수 시험(네트워크·파일 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptContent, acceptRequests, acceptVerdicts, cefr3, countNews, decide, exampleHasWord, factsFor, lemmatize,
  own, parseRss, parseTagesschau, pickCandidates, reviewPrompt, tokens, wordKey,
} from '../scripts/words/lib.mjs';

const INDEX = {
  forms: { Umzug: ['Umzug|noun'], Umzüge: ['Umzug|noun'], ermittelte: ['ermitteln|verb'], ermitteln: ['ermitteln|verb'], Vorfall: ['Vorfall|noun'], rief: ['anrufen|verb'], Bank: ['Bank|noun'] },
  facts: {
    'Umzug|noun': { g: ['der'], pl: 'Umzüge', en: 'move' },
    'ermitteln|verb': { en: 'to investigate' },
    'Vorfall|noun': { g: ['der'], pl: 'Vorfälle', en: 'incident' },
    'Haus|noun': { g: ['das'], pl: 'Häuser', en: 'house' },
    'EU|noun': { g: ['die'], pl: null, en: 'EU' },
    'Teil|noun': { g: ['der', 'das'], pl: 'Teile', en: 'part' },
  },
  daflex: { umzug: 'A2', ermitteln: 'B2', vorfall: 'B1', haus: 'A1', teil: 'A2' },
  leipzig: { 'Haus|noun': 3, 'Umzug|noun': 900, 'ermitteln|verb': 1200, 'Vorfall|noun': 30000, 'EU|noun': 5 },
};

test('wordKey · tokens · own', () => {
  assert.equal(wordKey('sich beschweren', 'verb'), 'beschweren|verb');
  assert.equal(wordKey('Umzug', 'noun'), 'Umzug|noun');
  assert.deepEqual(tokens('Der Umzug, ab 2026: Bund-Länder-Streit!'), ['Der', 'Umzug', 'Bund-Länder-Streit']);
  assert.equal(own({}, 'constructor'), undefined, '객체 기본 속성은 낱말이 아니다');
});

test('lemmatize: 대소문자 그대로, 문장 첫 낱말만 소문자로도', () => {
  assert.deepEqual(lemmatize('Ermittelte', INDEX, true), ['ermitteln|verb']);
  assert.deepEqual(lemmatize('Ermittelte', INDEX, false), []);
  assert.deepEqual(lemmatize('constructor', INDEX), []);
});

test('countNews: 한 기사 안 같은 열쇠는 1번, 마지막 링크', () => {
  const m = countNews([
    { title: 'Umzug: Polizei ermittelte nach Vorfall', text: 'Der Umzug war laut.', url: 'https://a' },
    { title: 'Vorfall in Hamburg', text: '', url: 'https://b' },
  ], INDEX);
  assert.deepEqual(m.get('Umzug|noun'), { n: 1, url: 'https://a' });
  assert.deepEqual(m.get('Vorfall|noun'), { n: 2, url: 'https://b' });
  assert.deepEqual(m.get('ermitteln|verb'), { n: 1, url: 'https://a' });
});

test('parseTagesschau · parseRss: 이상한 응답은 빈 목록', () => {
  assert.deepEqual(parseTagesschau({ news: [{ title: 'Zuckersteuer kommt', topline: 'Saarland', firstSentence: 'Lange wurde gestritten.', shareURL: 'https://www.sr.de/x' }, { title: 7 }] }),
    [{ title: 'Saarland Zuckersteuer kommt', text: 'Lange wurde gestritten.', url: 'https://www.sr.de/x' }]);
  for (const bad of [null, 'oops', {}, { news: 'x' }]) assert.deepEqual(parseTagesschau(bad), []);
  const xml = `<rss><channel><item><title><![CDATA[Prozess in Hamburg]]></title><description>&lt;p&gt;Es geht um &quot;Anschlag&quot; &amp; mehr&#8230;&lt;/p&gt;</description><link>https://www.ndr.de/a</link></item><item><title></title></item></channel></rss>`;
  assert.deepEqual(parseRss(xml), [{ title: 'Prozess in Hamburg', text: 'Es geht um "Anschlag" & mehr…', url: 'https://www.ndr.de/a' }]);
  for (const bad of ['<html><body>502 Bad Gateway</body></html>', '', null, '<item><title>&#99999999;</title></item>']) assert.ok(Array.isArray(parseRss(bad)));
});

test('cefr3', () => {
  assert.deepEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', undefined].map(cefr3), ['B1', 'B1', 'B1', 'B2', 'C1', 'C1', null]);
});

test('pickCandidates: 덱·뺀 것·사실 없음·A1/A2·약어·기준 미달 제외, 뉴스 2회 이상 먼저', () => {
  const hits = new Map([['Vorfall|noun', { n: 3, url: 'https://b' }], ['Fremd|noun', { n: 5, url: null }]]);
  const out = pickCandidates({ index: INDEX, have: new Set(['haus|noun']), skips: new Set(), hits, max: 10 });
  assert.deepEqual(out.map((c) => c.key), ['Vorfall|noun', 'ermitteln|verb']);
  assert.deepEqual(out[0], { key: 'Vorfall|noun', lemma: 'Vorfall', pos: 'noun', rank: 30000, hits: 3, level: 'B1' });
  assert.equal(out[1].level, 'B2');
  assert.deepEqual(pickCandidates({ index: INDEX, have: new Set(), skips: new Set(['ermitteln|verb']), hits: new Map(), max: 10 }).map((c) => c.key), []);
});

test('acceptContent · acceptRequests: 모양이 틀린 줄은 버림', () => {
  const list = [{ key: 'A|noun' }, { key: 'B|noun' }, { key: 'C|noun' }];
  const got = acceptContent([
    { key: 'A|noun', keep: true, gloss_ko: '가', example_de: 'Das ist A.', example_ko: '이건 A예요.', scene_en: 'Borti holds A.' },
    { key: 'B|noun', keep: false, reason: '영화 말' },
    { key: 'C|noun', keep: true, gloss_ko: '다', example_de: 'x'.repeat(71), example_ko: '다', scene_en: 'Borti' },
    { key: 'Z|noun', keep: true },
  ], list);
  assert.deepEqual(got.map((x) => [x.key, x.keep]), [['A|noun', true], ['B|noun', false]]);
  const req = acceptRequests([
    { id: 1, keep: true, lemma: 'Ermittlung', pos: 'noun', gender: 'die', plural: 'Ermittlungen', level: 'B2', gloss_ko: '수사', example_de: 'Die Ermittlung läuft.', example_ko: '수사가 진행 중이에요.', scene_en: 'Borti with a magnifier.' },
    { id: 2, keep: true, lemma: 'https://x', pos: 'noun', gloss_ko: '?', example_de: 'x', example_ko: 'x', scene_en: 'Borti x' },
    { id: 3, keep: false, reason: '사람 이름' },
    { id: 4, keep: true, lemma: 'Haus', pos: 'thing', gloss_ko: '집', example_de: 'Haus.', example_ko: '집.', scene_en: 'Borti home' },
  ], [1, 2, 3]);
  assert.equal(req.get(1).lemma, 'Ermittlung');
  assert.equal(req.has(2), false);
  assert.deepEqual(req.get(3), { keep: false, reason: '사람 이름' });
  assert.equal(req.has(4), false, '모르는 id');
});

test('acceptVerdicts: 모르는·겹친 id, 틀린 타입, 모르는 칸은 버림 (Review Focus 1)', () => {
  const v = acceptVerdicts([
    { id: 'w1', ok: true },
    { id: 'w1', ok: false, fix: { gloss_ko: '두 번째는 무시' } },
    { id: 'w2', ok: false, fix: { gloss_ko: '이사', gender: 3, lemma: 'Hack', plural: null, level: 'B2' }, meaning_changed: 'yes', why: 'x'.repeat(300) },
    { id: 'w9', ok: false, fix: { gloss_ko: '?' } },
    { id: 'w3', ok: 'false' },
    'junk',
  ], ['w1', 'w2', 'w3']);
  assert.deepEqual([...v.keys()], ['w1', 'w2']);
  assert.deepEqual(v.get('w2'), { ok: false, fix: { gloss_ko: '이사', plural: null, level: 'B2' }, meaning_changed: false, why: 'x'.repeat(200) });
  assert.deepEqual(acceptVerdicts(null, ['w1']), new Map());
});

const W = (o = {}) => ({ id: 'w1', lemma: 'Umzug', pos: 'noun', gender: 'der', plural: 'Umzüge', level: 'B1', gloss_ko: '이동', gloss_status: 'generated',
  example_de: 'Der Umzug war anstrengend.', example_ko: '이사는 힘들었어요.', checked_at: null, reverted: [], report: null, ...o });
const F = (o = {}) => ({ genders: ['der'], plural: 'Umzüge', daflexRaw: 'A2', daflex: 'B1', hasForm: (de) => /Umz/.test(de), ...o });

test('decide: 맞음 → 바꿀 것 없음, 신고된 카드면 확인 필요 메모', () => {
  assert.deepEqual(decide(W(), F(), { ok: true }), { patch: {}, changes: [], meaningChanged: false });
  const r = decide(W({ report: { kind: 'example', note: '어색' } }), F(), { ok: true });
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].field, 'note');
  assert.equal(r.changes[0].applied, 0);
});

test('decide: 뜻 고침 · 뜻이 바뀌면 그림 다시 · mine·40자 넘음·되돌린 칸은 확인 필요 (Review Focus 2)', () => {
  const r = decide(W(), F(), { ok: false, fix: { gloss_ko: ' 이사 ' }, meaning_changed: true, why: '주된 뜻' });
  assert.deepEqual(r.patch, { gloss_ko: '이사' });
  assert.deepEqual(r.changes, [{ field: 'gloss_ko', old: '이동', new: '이사', why: '주된 뜻', applied: 1 }]);
  assert.equal(r.meaningChanged, true);
  for (const [w, reason] of [[W({ gloss_status: 'mine' }), '내가 쓴 뜻'], [W(), '형식'], [W(), '되돌린']]) {
    const gloss = reason === '형식' ? '가'.repeat(41) : '이사';
    const d = decide(w, F(), { ok: false, fix: { gloss_ko: gloss }, meaning_changed: true }, reason === '되돌린' ? new Set(['gloss_ko']) : new Set());
    assert.deepEqual(d.patch, {}, reason);
    assert.equal(d.changes[0].applied, 0);
    assert.match(d.changes[0].why, new RegExp(reason));
    assert.equal(d.meaningChanged, false);
  }
});

test('decide: 예문은 번역과 같이만 · 표제어 없는 예문 거절 · 번역만 고침', () => {
  const ok = decide(W(), F(), { ok: false, fix: { example_de: 'Der Umzug dauerte lange.', example_ko: '이사는 오래 걸렸어요.' } });
  assert.deepEqual(ok.patch, { example_de: 'Der Umzug dauerte lange.', example_ko: '이사는 오래 걸렸어요.' });
  assert.equal(decide(W(), F(), { ok: false, fix: { example_de: 'Der Umzug dauerte lange.' } }).changes[0].applied, 0);
  assert.match(decide(W(), F(), { ok: false, fix: { example_de: 'Das Wetter ist schön.', example_ko: '날씨가 좋아요.' } }).changes[0].why, /표제어/);
  assert.deepEqual(decide(W(), F(), { ok: false, fix: { example_ko: '이사는 정말 힘들었어요.' } }).patch, { example_ko: '이사는 정말 힘들었어요.' });
  // 독일어는 그대로, 번역만 다름
  assert.deepEqual(decide(W(), F(), { ok: false, fix: { example_de: 'Der Umzug war anstrengend.', example_ko: '이사는 고됐어요.' } }).patch, { example_ko: '이사는 고됐어요.' });
});

test('decide: 관사·복수는 위키낱말사전과 같을 때만, 레벨은 DAFlex 와 같을 때만, 근거 없으면 확인 필요', () => {
  assert.deepEqual(decide(W({ gender: 'die' }), F(), { ok: false, fix: { gender: 'der' } }).patch, { gender: 'der' });
  assert.equal(decide(W(), F(), { ok: false, fix: { gender: 'das' } }).changes[0].applied, 0);
  assert.equal(decide(W(), F({ genders: null }), { ok: false, fix: { gender: 'die' } }).changes[0].applied, 0);
  assert.equal(decide(W(), F(), { ok: false, fix: { gender: 'm' } }).changes[0].applied, 0);
  assert.deepEqual(decide(W({ plural: 'Umzugs' }), F(), { ok: false, fix: { plural: 'Umzüge' } }).patch, { plural: 'Umzüge' });
  assert.equal(decide(W(), F({ plural: undefined }), { ok: false, fix: { plural: 'Umzüger' } }).changes[0].applied, 0);
  assert.deepEqual(decide(W({ level: 'C1' }), F(), { ok: false, fix: { level: 'B1' } }).patch, { level: 'B1' });
  assert.equal(decide(W(), F(), { ok: false, fix: { level: 'C1' } }).changes[0].applied, 0);
  // 고칠 값이 없거나 지금 값과 같으면 메모만
  assert.equal(decide(W(), F(), { ok: false, fix: { gloss_ko: '이동' }, why: '애매' }).changes[0].field, 'note');
});

test('exampleHasWord · factsFor · reviewPrompt', () => {
  const w = { lemma: 'ermitteln', pos: 'verb' };
  assert.equal(exampleHasWord('Die Polizei ermittelt.', w, null), true, '어간');
  assert.equal(exampleHasWord('Ermittelte sie?', w, INDEX), true, '색인 활용형 + 첫 낱말');
  assert.equal(exampleHasWord('Sie rief gestern an.', { lemma: 'anrufen', pos: 'verb' }, INDEX), true, '분리동사');
  assert.equal(exampleHasWord('Das Wetter ist schön.', w, INDEX), false);
  const f = factsFor({ lemma: 'Umzug', pos: 'noun' }, INDEX);
  assert.deepEqual([f.genders, f.plural, f.daflexRaw, f.daflex], [['der'], 'Umzüge', 'A2', 'B1']);
  const none = factsFor({ lemma: 'Umzug', pos: 'noun' }, null);
  assert.deepEqual([none.genders, none.plural, none.daflex], [null, undefined, null]);
  const p = reviewPrompt([W({ report: { kind: 'meaning', note: null } })], (w2) => factsFor(w2, INDEX));
  assert.match(p, /"learner_report":\{"kind":"meaning"/);
  assert.match(p, /"wiktionary_plural":"Umzüge"/);
  assert.match(p, /exactly 1 objects/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/words-lib.test.mjs`
Expected: FAIL — `Cannot find module '…/scripts/words/lib.mjs'`

- [ ] **Step 3: 구현** — `scripts/words/lib.mjs`

```js
// 매일 단어 작업(news.mjs · review.mjs)과 update.mjs 가 같이 쓰는 순수 함수 — 네트워크·파일 없음.
// 시험: tests/words-lib.test.mjs · 설계: docs/superpowers/specs/2026-10-15-word-review-news-design.md
import { findWord } from '../../shared/cloze.ts';
import { REQ_TEXT } from '../../shared/request.ts';

/** JSON 에서 읽은 객체의 자기 칸만(constructor·__proto__ 같은 이름이 낱말로 와도 안전) */
export const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);

/** 열쇠 = 기본형|품사, 앞의 sich 는 뺀다(대소문자 그대로). worker/words.ts KEY_SQL 과 같은 규칙 */
export const wordKey = (lemma, pos) => `${String(lemma).replace(/^sich\s+/i, '').trim()}|${pos}`;

const WORD_RE = /[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*/g;
/** 글 → 3자 이상 낱말(글자·붙임표만) */
export const tokens = (text) => [...String(text ?? '').matchAll(WORD_RE)].map((m) => m[0]).filter((t) => t.length >= 3);

/** 낱말 → 기본형 열쇠들. 색인 forms 는 대소문자 그대로라 문장 첫 낱말만 첫 글자를 소문자로도 찾는다 */
export function lemmatize(tok, index, first = false) {
  const hit = own(index.forms, tok);
  if (hit) return hit;
  if (first && tok) return own(index.forms, tok[0].toLowerCase() + tok.slice(1)) ?? [];
  return [];
}

/** 기사 묶음 → Map(열쇠 → {n: 나온 기사 수, url: 마지막 기사 링크}). 한 기사 안에서 같은 열쇠는 1번 */
export function countNews(articles, index) {
  const out = new Map();
  for (const a of articles) {
    const seen = new Set();
    for (const part of [a.title, a.text]) tokens(part).forEach((t, i) => lemmatize(t, index, i === 0).forEach((k) => seen.add(k)));
    for (const k of seen) {
      const o = out.get(k) ?? { n: 0, url: null };
      o.n++;
      if (a.url) o.url = a.url;
      out.set(k, o);
    }
  }
  return out;
}

/** tagesschau api2u/news 응답 → [{title, text, url}]. 모양이 다르면 빈 목록 */
export function parseTagesschau(j) {
  const news = Array.isArray(j?.news) ? j.news : [];
  return news
    .filter((n) => n && typeof n.title === 'string')
    .map((n) => ({
      title: [n.topline, n.title].filter((x) => typeof x === 'string' && x).join(' '),
      text: typeof n.firstSentence === 'string' ? n.firstSentence : '',
      url: typeof n.shareURL === 'string' && n.shareURL.startsWith('https://') ? n.shareURL : null,
    }));
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function entity(m, e) {
  if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
  const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  try {
    return String.fromCodePoint(code);
  } catch {
    return ' '; // 범위 밖 번호
  }
}
/** XML 글 → 맨 글(CDATA 풀기 → 엔티티 풀기 → 태그 빼기) */
function unxml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, entity)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/** RSS 2.0 → [{title, text, url}]. item 이 없으면 빈 목록 */
export function parseRss(xml) {
  const out = [];
  for (const m of String(xml ?? '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const get = (tag) => {
      const r = m[1].match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
      return r ? unxml(r[1]) : '';
    };
    const title = get('title');
    if (!title) continue;
    const link = get('link');
    out.push({ title, text: get('description'), url: link.startsWith('https://') ? link : null });
  }
  return out;
}

/** DAFlex 첫 단계(A1…C2) → 우리 레벨. A1·A2·B1 → B1, B2 → B2, C1·C2 → C1, 모르면 null */
export const cefr3 = (d) => (d === 'A1' || d === 'A2' || d === 'B1' ? 'B1' : d === 'B2' ? 'B2' : d === 'C1' || d === 'C2' ? 'C1' : null);

/**
 * 새 단어 후보: 덱에 없고 · 뺀 적 없고 · 위키낱말사전 표제어이고 · A1/A2 아니고 · 약어 아니고 ·
 * (Leipzig 순위 ≤ rankMax 또는 최근 30일 뉴스 2회 이상). 순서 = 뉴스 2회 이상 → 뉴스 수 → Leipzig 순위.
 * have = 덱 열쇠 소문자 Set, skips = 뺀 열쇠 Set, hits = Map(열쇠 → {n})
 */
export function pickCandidates({ index, have, skips, hits, max = 30, rankMax = 20000 }) {
  const out = [];
  for (const key of new Set([...Object.keys(index.leipzig), ...hits.keys()])) {
    const rank = own(index.leipzig, key) ?? null;
    const n = hits.get(key)?.n ?? 0;
    if (!(n >= 2 || (rank !== null && rank <= rankMax))) continue;
    if (have.has(key.toLowerCase()) || skips.has(key) || !own(index.facts, key)) continue;
    const [lemma, pos] = key.split('|');
    if (lemma.length < 3 || /^[A-ZÄÖÜ]{2,}$/.test(lemma)) continue; // 약어(EU·SPD)
    const d = own(index.daflex, lemma.toLowerCase());
    if (d === 'A1' || d === 'A2') continue; // 이미 아는 단계
    out.push({ key, lemma, pos, rank, hits: n, level: cefr3(d) ?? 'C1' });
  }
  out.sort((a, b) => Number(b.hits >= 2) - Number(a.hits >= 2) || b.hits - a.hits || (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.lemma.localeCompare(b.lemma, 'de'));
  return out.slice(0, max);
}

// ---------- Claude 프롬프트 · 답 검사 ----------

const s = (v) => (typeof v === 'string' ? v.trim() : '');
const POS = new Set(['noun', 'verb', 'adj', 'adv', 'prep', 'conj', 'pron', 'num', 'phrase', 'other']);
const RULES = [
  '  · gloss_ko: 짧은 한국어 뜻 1~3개, 쉼표 구분, 20자 이내(명사는 관사 없이 명사형, 동사는 ~하다/되다 형, 형용사는 ~한/~적인 형, 부사는 ~게/~히 형). 오스트리아·스위스 어휘는 뜻에 (오) (스) 표기.',
  "  · example_de: natural German sentence at the item's level, ≤70 chars, contains the headword (inflected/separated forms fine), everyday/work/news context.",
  '  · example_ko: 자연스러운 한국어 번역, 40자 이내, ~해요체.',
  '  · scene_en: ONE English line, ≤25 words, starting with "Borti " — a concrete visual scene where the mascot Borti (a chubby cream dachshund puppy with brown floppy ears) acts out the meaning with a concrete prop or action. No text, letters, numbers, signs, or logos. Only Borti unless a second character is needed ("another puppy"). Keep it gentle and family-friendly even for crime/violence words (show it symbolically: e.g. a detective magnifying glass, a broken vase).',
].join('\n');

/** 카드 글 쓰기(keep 판정 포함). update.mjs 의 예전 writeContent 프롬프트와 같은 규칙 */
export function contentPrompt(list, source = 'a subtitle-frequency source') {
  return `You write Korean learning content for German vocabulary (personal flashcard app "Wortling"; learner = Korean speaker moving from B1 to B2 and C1). Each item has its CEFR level. The list comes from ${source}, so some entries are not useful.
Return exactly one object per input item, same order, key copied unchanged.
- Useful word → {"key", "keep": true, "gloss_ko", "example_de", "example_ko", "scene_en"}
${RULES}
- Not useful → {"key", "keep": false, "reason": "짧은 사유"}. Use false for: vulgar/sexual/slang words, proper names and nationality/ethnic labels, English loan slang typical of dubbed films (Bingo, Amigo), archaic words, very narrow jargon, words that only make sense in film dialogue (Samurai, Satan, Pirat). News/daily/work vocabulary is keep:true even if it is about crime or conflict (Mörder, Verhör, Haftbefehl). When unsure → true.
Output ONLY a JSON array (no prose, no code fence) with exactly ${list.length} objects.
Items: ${JSON.stringify(list)}`;
}

/** contentPrompt 답 → 통과한 것만(묶음 작업과 같은 조건). 나머지는 다음 실행 때 다시 */
export function acceptContent(arr, list) {
  const keys = new Set(list.map((w) => w.key));
  const res = [];
  for (const o of Array.isArray(arr) ? arr : []) {
    if (!o || !keys.has(o.key) || typeof o.keep !== 'boolean') continue;
    if (!o.keep) {
      res.push({ key: o.key, keep: false, reason: s(o.reason).slice(0, 60) || '(사유 없음)' });
      continue;
    }
    const c = { key: o.key, keep: true, gloss_ko: s(o.gloss_ko).slice(0, 40), example_de: s(o.example_de), example_ko: s(o.example_ko).slice(0, 80), scene_en: s(o.scene_en).slice(0, 300) };
    if (c.gloss_ko && c.example_de && c.example_de.length <= 70 && c.example_ko && c.scene_en.startsWith('Borti ')) res.push(c);
  }
  return res;
}

/** 내가 넣은 단어(활용형·오타 가능) → 기본형·품사 + 카드 글 */
export function requestPrompt(list) {
  return `You turn words that a Korean learner of German (B1 → C1) met while reading news into flashcards (personal app "Wortling"). Each item is exactly what the learner typed: it may be inflected ("ermittelte"), part of a separable verb, or misspelled.
Return exactly one object per input item, same order, id copied unchanged.
- A real German word or fixed expression → {"id", "keep": true, "lemma", "pos", "gender", "plural", "level", "gloss_ko", "example_de", "example_ko", "scene_en"}
  · lemma: dictionary form (nouns capitalized without article, verbs infinitive, adjectives base form).
  · pos: one of noun verb adj adv prep conj pron num phrase other.
  · gender: der|die|das for nouns, otherwise null. plural: the noun plural, otherwise null.
  · level: your CEFR estimate B1|B2|C1 (B1 for anything easier).
${RULES}
- Not usable (gibberish, a person or place name, not German) → {"id", "keep": false, "reason": "짧은 사유"}.
Output ONLY a JSON array (no prose, no code fence) with exactly ${list.length} objects.
Items: ${JSON.stringify(list)}`;
}

/** requestPrompt 답 → Map(id → 값). 모양이 틀린 줄은 버린다(다음 날 다시) */
export function acceptRequests(arr, ids) {
  const want = new Set(ids);
  const out = new Map();
  for (const o of Array.isArray(arr) ? arr : []) {
    if (!o || !want.has(o.id) || typeof o.keep !== 'boolean' || out.has(o.id)) continue;
    if (!o.keep) {
      out.set(o.id, { keep: false, reason: s(o.reason).slice(0, 60) || '(사유 없음)' });
      continue;
    }
    const c = {
      keep: true, lemma: s(o.lemma), pos: s(o.pos),
      gender: ['der', 'die', 'das'].includes(o.gender) ? o.gender : null,
      plural: s(o.plural) || null,
      level: ['B1', 'B2', 'C1'].includes(o.level) ? o.level : 'B2',
      gloss_ko: s(o.gloss_ko).slice(0, 40), example_de: s(o.example_de), example_ko: s(o.example_ko).slice(0, 80), scene_en: s(o.scene_en).slice(0, 300),
    };
    if (REQ_TEXT.test(c.lemma) && POS.has(c.pos) && c.gloss_ko && c.example_de && c.example_de.length <= 70 && c.example_ko && c.scene_en.startsWith('Borti ')) out.set(o.id, c);
  }
  return out;
}

// ---------- 검토 ----------

/** 예문에 표제어(활용형)가 있나 — 카드 굵게 표시 규칙(findWord) 또는 색인 활용형 */
export function exampleHasWord(de, w, index) {
  if (findWord(de, w.lemma)) return true;
  if (!index) return false;
  const key = wordKey(w.lemma, w.pos);
  return tokens(de).some((t, i) => lemmatize(t, index, i === 0).includes(key));
}

/** 검토 근거. 색인이 없으면 모름 → 관사·복수·레벨은 자동으로 「확인 필요」 */
export function factsFor(w, index) {
  const f = index ? own(index.facts, wordKey(w.lemma, w.pos)) : undefined;
  const raw = index ? (own(index.daflex, w.lemma.toLowerCase()) ?? null) : null;
  return {
    genders: f?.g?.length ? f.g : null,
    plural: f ? (f.pl ?? null) : undefined,
    daflexRaw: raw,
    daflex: cefr3(raw),
    hasForm: (de) => exampleHasWord(de, w, index),
  };
}

export function reviewPrompt(items, factsOf) {
  const list = items.map((w) => {
    const f = factsOf(w);
    return {
      id: w.id, lemma: w.lemma, pos: w.pos, gender: w.gender, plural: w.plural, level: w.level,
      gloss_ko: w.gloss_ko, example_de: w.example_de, example_ko: w.example_ko,
      facts: {
        wiktionary_genders: f.genders ?? 'unknown',
        wiktionary_plural: f.plural === undefined ? 'unknown' : f.plural,
        daflex_first_level: f.daflexRaw ?? 'unknown',
        example_contains_headword: w.example_de ? f.hasForm(w.example_de) : null,
      },
      ...(w.report ? { learner_report: w.report } : {}),
    };
  });
  return `You review Korean learning content on German flashcards (personal app "Wortling"; learner = Korean speaker moving from B1 to B2 and C1). For each item check:
1. gloss_ko — the main, common Korean meaning(s) of the headword for its part of speech; 1~3 meanings, 쉼표 구분, 40자 이내 (명사 명사형 · 동사 ~하다/되다 · 형용사 ~한/~적인 · 부사 ~게/~히).
2. example_de — natural, grammatical German, ≤70 chars, uses the headword (inflected or separated forms fine) in the meaning of gloss_ko.
3. example_ko — faithful, natural Korean translation of example_de in ~해요체, ≤80자.
4. gender / plural (nouns) — compare with facts.wiktionary_* (from Wiktionary).
5. level — CEFR level for this learner (B1|B2|C1); facts.daflex_first_level = first textbook level where the word appears (A1/A2 mean "B1" here).
If learner_report is present, the learner flagged this card — check that part especially carefully.
Return exactly one object per item, same order, id copied:
- Everything fine → {"id", "ok": true}
- Clear error → {"id", "ok": false, "fix": {only the corrected fields among gloss_ko, example_de, example_ko, gender, plural, level}, "meaning_changed": true only if the corrected gloss_ko is a different meaning (not just wording), "why": "한국어 한 줄 사유"}
Be conservative: fix clear mistakes only, not style preferences. If you change example_de, also give the matching example_ko.
Output ONLY a JSON array (no prose, no code fence) with exactly ${list.length} objects.
Items: ${JSON.stringify(list)}`;
}

export const FIX_FIELDS = ['gloss_ko', 'example_de', 'example_ko', 'gender', 'plural', 'level'];

/** reviewPrompt 답 → Map(id → 판정). 모르는·겹친 id, 타입이 틀린 칸은 버린다 */
export function acceptVerdicts(arr, ids) {
  const want = new Set(ids);
  const out = new Map();
  for (const o of Array.isArray(arr) ? arr : []) {
    if (!o || typeof o !== 'object' || !want.has(o.id) || typeof o.ok !== 'boolean' || out.has(o.id)) continue;
    if (o.ok) {
      out.set(o.id, { ok: true });
      continue;
    }
    const src = o.fix && typeof o.fix === 'object' ? o.fix : {};
    const fix = {};
    for (const k of FIX_FIELDS) {
      if (!Object.hasOwn(src, k)) continue;
      if (typeof src[k] === 'string' || (k === 'plural' && src[k] === null)) fix[k] = src[k];
    }
    out.set(o.id, { ok: false, fix, meaning_changed: o.meaning_changed === true, why: typeof o.why === 'string' ? o.why.slice(0, 200) : '' });
  }
  return out;
}

const GENDERS = ['der', 'die', 'das'];
const LEVELS = ['B1', 'B2', 'C1'];

/**
 * 판정 하나 → 바꿀 칸(patch)과 기록(changes). 규칙 = 설계 「2. 검토 규칙」 표:
 * 뜻·예문·번역 = Claude 값 + 형식 검사 / 관사·복수 = 위키낱말사전과 같을 때만 / 레벨 = DAFlex 와 같을 때만 /
 * 되돌린 칸·내가 쓴 뜻(mine) = 안 바꿈. 안 바꾼 것은 applied 0(「확인 필요」)으로 남긴다.
 * w = ReviewQueueItem, facts = factsFor(), v = acceptVerdicts 값, reverted = 되돌린 칸 Set
 */
export function decide(w, facts, v, reverted = new Set()) {
  const patch = {};
  const changes = [];
  const why = v.why || '검토 판정';
  const note = (text) => changes.push({ field: 'note', old: null, new: null, why: text, applied: 0 });
  if (v.ok) {
    if (w.report) note(`신고(${w.report.kind}${w.report.note ? ': ' + w.report.note : ''})됐지만 검토 결과 맞음`);
    return { patch, changes, meaningChanged: false };
  }
  const apply = (field, value) => {
    patch[field] = value;
    changes.push({ field, old: w[field] ?? null, new: value, why, applied: 1 });
  };
  const tryField = (field, value, check) => {
    if (value === (w[field] ?? null)) return; // 그대로
    const no = reverted.has(field) ? '되돌린 적 있는 칸' : check(value);
    if (no) changes.push({ field, old: w[field] ?? null, new: value ?? null, why: `${why} · 안 바꿈: ${no}`, applied: 0 });
    else apply(field, value);
  };
  const fix = v.fix ?? {};
  const t = (x) => (typeof x === 'string' ? x.trim() : x);

  if (fix.gloss_ko !== undefined)
    tryField('gloss_ko', t(fix.gloss_ko), (g) => (w.gloss_status === 'mine' ? '내가 쓴 뜻' : !g || g.length > 40 ? '형식(40자 이내)' : null));

  const de = t(fix.example_de);
  const ko = fix.example_ko === undefined ? undefined : t(fix.example_ko);
  if (fix.example_de !== undefined && de !== (w.example_de ?? null)) {
    tryField('example_de', de, (x) =>
      ko === undefined ? '번역 없이 예문만 옴'
        : !x || x.length > 70 ? '형식(70자 이내)'
          : !facts.hasForm(x) ? '예문에 표제어가 없음'
            : !ko || ko.length > 80 ? '번역 형식(80자 이내)'
              : null);
    if (patch.example_de !== undefined && ko !== (w.example_ko ?? null)) apply('example_ko', ko);
  } else if (ko !== undefined) {
    tryField('example_ko', ko, (x) => (!x || x.length > 80 ? '번역 형식(80자 이내)' : null));
  }

  if (fix.gender !== undefined)
    tryField('gender', t(fix.gender), (g) => (!GENDERS.includes(g) ? '형식' : !facts.genders?.includes(g) ? `위키낱말사전: ${facts.genders?.join('/') ?? '모름'}` : null));
  if (fix.plural !== undefined)
    tryField('plural', t(fix.plural), (p) => (facts.plural === undefined ? '위키낱말사전에 없음' : p !== facts.plural ? `위키낱말사전: ${facts.plural ?? '복수 없음'}` : null));
  if (fix.level !== undefined)
    tryField('level', t(fix.level), (lv) => (!LEVELS.includes(lv) ? '형식' : facts.daflex !== lv ? `DAFlex: ${facts.daflex ?? '모름'}` : null));

  if (!changes.length) note(`${why} · 고칠 값 없음`);
  return { patch, changes, meaningChanged: v.meaning_changed === true && patch.gloss_ko !== undefined };
}

/** 일요일 디스코드 요약 */
export function summaryText(st) {
  const pct = st.total ? Math.round((st.checked / st.total) * 100) : 0;
  return `검토한 카드 ${st.checked}/${st.total} (${pct}%)\n이번 주: 고침 ${st.week.applied} · 확인 필요 ${st.week.flagged} · 새 단어(뉴스) ${st.week.news} · 내가 넣은 ${st.week.mine}\n앱 설정 → 고친 카드에서 보고 되돌릴 수 있어요.`;
}
```

- [ ] **Step 4: update.mjs 가 같이 쓰기** — `scripts/words/update.mjs` 233~261줄(`async function writeContent(batch) {` … 함수 끝 `}`)을 바꾸고 맨 위 import 에 한 줄 더한다.

```js
import { acceptContent, contentPrompt } from './lib.mjs';
```

```js
// ── 5) claude -p 로 판정·채우기 (프롬프트·검사는 lib.mjs — news.mjs 와 같음) ─────────────────
async function writeContent(batch) {
  const list = batch.map((w) => ({ key: `${w.lemma}|${w.pos}`, lemma: w.lemma, pos: w.pos, gender: w.gender, level: w.level, gloss_en: w.gloss_en }));
  const out = await runClaude(contentPrompt(list));
  const text = String(JSON.parse(out).result ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let arr;
  try { arr = JSON.parse(text); } catch { throw new Error(`claude 결과가 JSON 이 아님: ${text.slice(0, 200)}`); }
  return acceptContent(arr, list);
}
```

- [ ] **Step 5: 통과 확인**

Run: `node --test tests/words-lib.test.mjs && npm test && node scripts/words/update.mjs --dry --max=5`
Expected: 시험 PASS · update.mjs dry 가 오류 없이 「[dry] 넣을 수 있는 단어 …」 출력

- [ ] **Step 6: Commit**

```bash
git add scripts/words/lib.mjs scripts/words/update.mjs tests/words-lib.test.mjs
git commit -m "feat(words): 검토·뉴스 단어 순수 함수(판정 적용 규칙 · 뉴스 수 · 후보 고르기)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 원본 받기 + 색인 `scripts/words/sources.mjs`

**Files:**
- Create: `scripts/words/sources.mjs`
- Test: `tests/words-lib.test.mjs`

**Interfaces:**
- Consumes: `wordKey`
- Produces: `parseDaflex(text) → {소문자: 'A1'…'C2'}`, `parseLeipzig(text) → Map<form, freq>`, `buildIndex({kaikkiLines: AsyncIterable<string>|Iterable<string>, daflexText, leipzigText, deckKeys?, month, src?}) → Promise<Index>`, `ensureIndex({dir, deckKeys, log, now?}) → Promise<{index: Index|null, rebuilt: boolean}>`

- [ ] **Step 1: 실패하는 시험** — `tests/words-lib.test.mjs` 끝에

```js
import { buildIndex, parseDaflex, parseLeipzig } from '../scripts/words/sources.mjs';

const KAIKKI = [
  { word: 'Umzug', pos: 'noun', forms: [{ form: 'Umzüge', tags: ['plural'] }, { form: 'Umzugs', tags: ['genitive'] }, { form: 'strong', tags: ['table-tags'] }], senses: [{ glosses: ['move, relocation'], tags: ['masculine'] }] },
  { word: 'ermitteln', pos: 'verb', forms: [{ form: 'ermittelte', tags: ['past'] }, { form: 'haben', tags: ['auxiliary'] }], senses: [{ glosses: ['to investigate'] }] },
  { word: 'anrufen', pos: 'verb', forms: [{ form: 'rief an', tags: ['past'] }], senses: [{ glosses: ['to call'] }] },
  { word: 'Umzüge', pos: 'noun', senses: [{ form_of: [{ word: 'Umzug' }], glosses: ['plural of Umzug'] }] },
  { word: 'Berlin', pos: 'name', senses: [{ glosses: ['capital'] }] },
  { word: 'Zzzwort', pos: 'noun', senses: [{ glosses: ['rare'], tags: ['neuter'] }] },
].map((o) => JSON.stringify(o)).concat(['not json', '']);
const DAFLEX = '"word"\t"tag"\t"level_freq@a1"\t"level_freq@a2"\t"level_freq@b1"\t"level_freq@b2"\t"level_freq@c1"\t"level_freq@c2"\n'
  + '"umzug"\t"NN"\t"0.0"\t"1.2"\t"0.0"\t"0.0"\t"0.0"\t"0.0"\n"berlin"\t"NE"\t"5"\t"0"\t"0"\t"0"\t"0"\t"0"\n"ermitteln"\t"VVINF"\t"0"\t"0"\t"0"\t"0.4"\t"0"\t"0"\n';
const LEIPZIG = '1\tUmzüge\t30\n2\tUmzug\t20\n3\termittelte\t70\n4\trief\t5\n5\tBerlin\t500\n6\tkaputt-zeile\n';

test('parseDaflex · parseLeipzig', () => {
  assert.deepEqual(parseDaflex(DAFLEX), { umzug: 'A2', ermitteln: 'B2' });
  assert.deepEqual([...parseLeipzig(LEIPZIG)], [['Umzüge', 30], ['Umzug', 20], ['ermittelte', 70], ['rief', 5], ['Berlin', 500]]);
});

test('buildIndex: 말뭉치·덱에 있는 표제어만, 활용형 → 기본형, 성·복수·영어 뜻, Leipzig 기본형 순위', async () => {
  const ix = await buildIndex({ kaikkiLines: KAIKKI, daflexText: DAFLEX, leipzigText: LEIPZIG, deckKeys: [], month: '2026-10' });
  assert.equal(ix.month, '2026-10');
  assert.deepEqual(ix.forms['Umzüge'], ['Umzug|noun']);
  assert.deepEqual(ix.forms['ermittelte'], ['ermitteln|verb']);
  assert.deepEqual(ix.forms['rief'], ['anrufen|verb']);
  assert.equal(Object.hasOwn(ix.forms, 'haben'), false, '조동사 칸은 활용형 아님');
  assert.equal(Object.hasOwn(ix.forms, 'Berlin'), false, '고유명사(name)는 안 넣음');
  assert.deepEqual(ix.facts['Umzug|noun'], { g: ['der'], pl: 'Umzüge', en: 'move, relocation' });
  assert.deepEqual(ix.facts['ermitteln|verb'], { en: 'to investigate' });
  assert.equal(Object.hasOwn(ix.facts, 'Zzzwort|noun'), false, '말뭉치에도 덱에도 없음');
  assert.deepEqual(ix.leipzig, { 'ermitteln|verb': 1, 'Umzug|noun': 2, 'anrufen|verb': 3 });
  assert.deepEqual(ix.daflex, { umzug: 'A2', ermitteln: 'B2' });
  const withDeck = await buildIndex({ kaikkiLines: KAIKKI, daflexText: DAFLEX, leipzigText: LEIPZIG, deckKeys: ['Zzzwort|noun'], month: '2026-10' });
  assert.deepEqual(withDeck.facts['Zzzwort|noun'], { g: ['das'], pl: null, en: 'rare' });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/words-lib.test.mjs`
Expected: FAIL — `Cannot find module '…/scripts/words/sources.mjs'`

- [ ] **Step 3: 구현** — `scripts/words/sources.mjs`

```js
// 원본 받기 + 색인 만들기(words.yml 의 Actions 캐시 .data/words-src/index.json — 달이 바뀌면 새로).
// kaikki 독일어 전체(영어판 위키낱말사전 추출, CC BY-SA) · DAFlex(UCLouvain, CC BY-NC-SA 4.0) · Leipzig 뉴스 말뭉치 300K(CC BY).
// 색인 = { month, built, src, forms: {활용형: [열쇠]}, facts: {열쇠: {g?, pl?, en}}, daflex: {소문자 낱말: 'A1'…'C2'}, leipzig: {열쇠: 순위} }
// 저장소에는 아무것도 커밋하지 않는다(DAFlex 는 비영리·같은 조건 유지). 원본 파일은 색인을 만든 뒤 지운다.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { wordKey } from './lib.mjs';

export const KAIKKI_URL = 'https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz';
export const DAFLEX_URL = 'https://cental.uclouvain.be/cefrlex/static/resources/de/DAFlex.tsv';
export const leipzigUrl = (year) => `https://downloads.wortschatz-leipzig.de/corpora/deu_news_${year}_300K.tar.gz`;
const UA = 'wortling-words (personal vocabulary app; github.com/0101-commits/wortling)';
const POS = new Set(['noun', 'verb', 'adj', 'adv']);
const LETTERS = /^[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*$/;
const GENDER = { masculine: 'der', feminine: 'die', neuter: 'das' };
const SKIP_TAGS = new Set(['table-tags', 'inflection-template', 'auxiliary', 'class']);
const LV = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];

/** DAFlex tsv → {소문자 낱말: 처음 나오는 단계}. 고유명사(NE)·외국어(FM) 제외, 같은 낱말 여러 품사면 가장 이른 단계 */
export function parseDaflex(text) {
  const lines = String(text).split(/\r?\n/);
  const head = lines[0].split('\t').map((h) => h.replace(/"/g, ''));
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const out = new Map();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const c = line.split('\t').map((x) => x.replace(/"/g, ''));
    if (c[col.tag] === 'NE' || c[col.tag] === 'FM') continue;
    const first = LV.findIndex((lv) => Number(c[col[`level_freq@${lv}`]]) > 0);
    if (first < 0) continue;
    const w = c[col.word].toLowerCase();
    if (!out.has(w) || first < out.get(w)) out.set(w, first);
  }
  return Object.fromEntries([...out].map(([w, i]) => [w, LV[i].toUpperCase()]));
}

/** Leipzig *-words.txt(번호 \t 낱말 \t 횟수) → Map(낱말 → 횟수) */
export function parseLeipzig(text) {
  const m = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const [, w, n] = line.split('\t');
    if (w && LETTERS.test(w) && Number(n) > 0) m.set(w, (m.get(w) ?? 0) + Number(n));
  }
  return m;
}

/** kaikki 줄들 → 색인. 말뭉치에 활용형이 하나라도 있거나 덱에 있는 표제어만 담는다(색인 크기 줄이기) */
export async function buildIndex({ kaikkiLines, daflexText, leipzigText, deckKeys = [], month, src = {} }) {
  const vocab = parseLeipzig(leipzigText);
  const deck = new Set(deckKeys.map((k) => k.toLowerCase()));
  const forms = new Map();
  const facts = new Map();
  for await (const line of kaikkiLines) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!POS.has(o.pos) || typeof o.word !== 'string' || !LETTERS.test(o.word)) continue;
    if ((o.senses ?? []).some((x) => x.form_of || x.alt_of)) continue; // 활용형 자체 항목(「Umzüge」 = Umzug 의 복수)
    const key = wordKey(o.word, o.pos);
    const fs = new Set([o.word]);
    for (const f of o.forms ?? []) {
      if (typeof f?.form !== 'string' || (f.tags ?? []).some((t) => SKIP_TAGS.has(t))) continue;
      const parts = f.form.split(' ');
      if (parts.length === 1 && LETTERS.test(parts[0])) fs.add(parts[0]);
      else if (parts.length === 2 && LETTERS.test(parts[0]) && LETTERS.test(parts[1])) fs.add(parts[0]); // 분리동사 「rief an」 → rief
    }
    const inDeck = deck.has(key.toLowerCase());
    if (!inDeck && ![...fs].some((f) => vocab.has(f))) continue;
    for (const f of fs) {
      if (!inDeck && !vocab.has(f)) continue;
      const a = forms.get(f) ?? [];
      if (!a.includes(key)) a.push(key);
      forms.set(f, a);
    }
    const prev = facts.get(key);
    const en = prev?.en ?? o.senses?.find((x) => x.glosses?.length)?.glosses[0]?.slice(0, 80) ?? null;
    if (o.pos === 'noun') {
      const g = new Set(prev?.g ?? []);
      for (const x of o.senses ?? []) for (const t of x.tags ?? []) if (GENDER[t]) g.add(GENDER[t]);
      const pl = prev?.pl ?? (o.forms ?? []).find((f) => f.tags?.length === 1 && f.tags[0] === 'plural')?.form ?? null;
      facts.set(key, { g: [...g], pl, en });
    } else facts.set(key, { en });
  }
  // Leipzig 순위: 활용형 횟수를 기본형으로 모은다(여러 기본형에 걸친 활용형은 양쪽에 더함)
  const sum = new Map();
  for (const [f, n] of vocab) for (const k of forms.get(f) ?? []) sum.set(k, (sum.get(k) ?? 0) + n);
  const leipzig = Object.fromEntries([...sum].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k], i) => [k, i + 1]));
  return { month, built: new Date().toISOString(), src, forms: Object.fromEntries(forms), facts: Object.fromEntries(facts), daflex: parseDaflex(daflexText), leipzig };
}

async function download(url, file) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20 * 60_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

/** 지난해 → 그 전해 순으로 Leipzig 뉴스 300K 를 찾아 *-words.txt 경로 */
async function leipzigWords(dir, now) {
  const y = now.getUTCFullYear();
  for (const year of [y - 1, y - 2]) {
    const url = leipzigUrl(year);
    const head = await fetch(url, { method: 'HEAD', headers: { 'user-agent': UA } }).catch(() => null);
    if (!head?.ok) continue;
    const tgz = path.join(dir, 'leipzig.tar.gz');
    await download(url, tgz);
    const out = path.join(dir, 'leipzig');
    mkdirSync(out, { recursive: true });
    execFileSync('tar', ['-xzf', tgz, '-C', out]);
    const name = `deu_news_${year}_300K`;
    return { file: path.join(out, name, `${name}-words.txt`), name };
  }
  throw new Error('Leipzig 뉴스 말뭉치를 못 찾음');
}

/** 이번 달 색인이 있으면 그대로, 없으면 새로 만든다. 실패하면 지난 색인(있으면)으로 */
export async function ensureIndex({ dir, deckKeys, log, now = new Date() }) {
  const file = path.join(dir, 'index.json');
  const month = now.toISOString().slice(0, 7);
  let old = null;
  try {
    old = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  } catch {
    old = null;
  }
  if (old?.month === month) return { index: old, rebuilt: false };
  try {
    mkdirSync(dir, { recursive: true });
    const kz = path.join(dir, 'kaikki-de.jsonl.gz');
    await download(KAIKKI_URL, kz);
    const dt = path.join(dir, 'DAFlex.tsv');
    await download(DAFLEX_URL, dt);
    const lw = await leipzigWords(dir, now);
    const lines = createInterface({ input: createReadStream(kz).pipe(createGunzip()), crlfDelay: Infinity });
    const index = await buildIndex({
      kaikkiLines: lines, daflexText: readFileSync(dt, 'utf8'), leipzigText: readFileSync(lw.file, 'utf8'), deckKeys, month,
      src: { kaikki: statSync(kz).mtime.toISOString().slice(0, 10), leipzig: lw.name },
    });
    writeFileSync(`${file}.tmp`, JSON.stringify(index));
    renameSync(`${file}.tmp`, file);
    for (const f of readdirSync(dir)) if (f !== 'index.json') rmSync(path.join(dir, f), { recursive: true, force: true });
    return { index, rebuilt: true };
  } catch (e) {
    log.errors.push(`색인 만들기 실패: ${String(e.message || e).slice(0, 200)}`);
    return { index: old, rebuilt: false };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/words-lib.test.mjs`
Expected: PASS

- [ ] **Step 5: 실물 색인 크기·시간 재기**(PC, 원본 ≈170MB 받음) — 시험 전용 한 줄:

Run: `node -e "import('./scripts/words/sources.mjs').then(async (m) => { const t = Date.now(); const log = { errors: [] }; const r = await m.ensureIndex({ dir: '.data/words-src', deckKeys: [], log }); const fs = await import('node:fs'); console.log({ ms: Date.now() - t, errors: log.errors, mb: (fs.statSync('.data/words-src/index.json').size / 1e6).toFixed(1), forms: Object.keys(r.index.forms).length, facts: Object.keys(r.index.facts).length, leipzig: Object.keys(r.index.leipzig).length, src: r.index.src }) })"`
Expected: `errors: []`, `mb` < 100, `forms`·`facts`·`leipzig` 가 0 이 아님, 5분 안. 100MB 를 넘으면 멈추고 보고(캐시·메모리 문제 — 말뭉치 낱말 필터를 더 좁혀야 함).

- [ ] **Step 6: Commit**

```bash
git add scripts/words/sources.mjs tests/words-lib.test.mjs
git commit -m "feat(words): kaikki·DAFlex·Leipzig 원본 받기와 색인(활용형→기본형·성·복수·뉴스 순위)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 매일 작업 1/2 `scripts/words/news.mjs` (+ `scripts/admin.mjs`)

**Files:**
- Create: `scripts/admin.mjs`, `scripts/words/news.mjs`

**Interfaces:**
- Consumes: `askJson`(scripts/claude.mjs), `ensureIndex`, lib 의 `wordKey` `own` `parseTagesschau` `parseRss` `countNews` `pickCandidates` `contentPrompt` `acceptContent` `requestPrompt` `acceptRequests` `cefr3`; 주소 Task 2·3
- Produces: `scripts/admin.mjs` → `ROOT`, `api(path, {method, body})`, `notify(type, title, desc)`, `kstDay(d?)`, `addDays(day, n)`, `requireEnv()`; 실행 `node scripts/words/news.mjs [--dry] [--max=N]`

- [ ] **Step 1: 공용 도우미** — `scripts/admin.mjs`

```js
// Worker 관리 API · 디스코드 알림 · 날짜 — words.yml 의 news.mjs · review.mjs 가 같이 쓴다.
// (daily.mjs · update.mjs 는 예전 사본을 그대로 쓴다.) .env 가 있으면 읽고, Actions 에서는 비밀값 환경변수.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || '';

export function requireEnv() {
  if (!APP_URL || !TOKEN) throw new Error('APP_URL · API_TOKEN 이 없다(.env 또는 Actions 비밀값)');
}

/** 관리 API. claude 를 기다리는 사이 묵은 연결이 끊기면 한 번 다시 */
export async function api(p, { method = 'GET', body } = {}) {
  const init = {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  };
  let res;
  try {
    res = await fetch(APP_URL + p, init);
  } catch (e) {
    console.error(`재시도 ${method} ${p}: ${e.cause?.code || e.message}`);
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(APP_URL + p, init);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** 디스코드 알림. PC 면 AI_CLI 알리미, 깃허브 서버면 DISCORD_WEBHOOK_URL 로 바로. 보냈으면 true */
export async function notify(type, title, desc) {
  const notifier = 'C:/Users/cgpar/AI_CLI/scripts/discord-notify.js';
  if (existsSync(notifier)) {
    const r = spawnSync(process.execPath, [notifier, 'send'], { input: JSON.stringify({ type, title, desc, cli: 'claude' }), encoding: 'utf8', windowsHide: true, timeout: 20000 });
    return r.status === 0;
  }
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: `**${title}**\n${desc}`.slice(0, 1900) }) });
    return res.ok;
  } catch {
    return false;
  }
}

export const kstDay = (d = new Date()) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
```

- [ ] **Step 2: 매일 작업 1/2** — `scripts/words/news.mjs`

```js
// 매일 단어 작업 1/2(words.yml, 05:17 KST): 내가 넣은 단어 → 뉴스 신호 → 새 단어 → 뉴스 순위 → 학습 순서. 다음은 review.mjs.
// 설계 docs/superpowers/specs/2026-10-15-word-review-news-design.md
// 옵션: --dry(서버에 안 씀, 수만) · --max=N(새 단어 상한, 기본 30). 환경: NEWS_FEEDS=0 이면 tagesschau·NDR 을 읽지 않는다.
// 뉴스 글은 어디에도 남기지 않는다 — 기본형별 기사 수와 링크 1개만 서버로, 로그엔 수만(공개 저장소의 Actions 로그).
import path from 'node:path';
import { askJson } from '../claude.mjs';
import { ROOT, addDays, api, kstDay, notify, requireEnv } from '../admin.mjs';
import { ensureIndex } from './sources.mjs';
import {
  acceptContent, acceptRequests, cefr3, contentPrompt, countNews, own, parseRss, parseTagesschau, pickCandidates, requestPrompt, wordKey,
} from './lib.mjs';

const DRY = process.argv.includes('--dry');
const MAX = Number((process.argv.find((a) => a.startsWith('--max=')) || '').slice(6)) || 30;
const FEEDS = process.env.NEWS_FEEDS !== '0';
const UA = 'wortling-words (personal vocabulary app; github.com/0101-commits/wortling)';
const FEED_URLS = [
  ['tagesschau', 'https://www.tagesschau.de/api2u/news'],
  ['ndr', 'https://www.ndr.de/fernsehen/barrierefreie_angebote/leichte_sprache/nachrichtenleichtesprache100~rss2.xml'],
];
const CHUNK = 400; // D1 batch 실측 상한

const day = kstDay();
const log = { day, dry: DRY, index: null, requests: null, news: {}, candidates: 0, added: 0, skipped: 0, ranks: 0, reseq: null, errors: [] };
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    log.errors.push(`${name}: ${String(e.message || e).slice(0, 200)}`);
  }
};
const lowerKeys = (items) => new Map(items.map((w) => [wordKey(w.lemma, w.pos).toLowerCase(), w.id]));

try {
  requireEnv();
  const keys = await api('/api/admin/keys');
  const { index, rebuilt } = await ensureIndex({ dir: path.join(ROOT, '.data', 'words-src'), deckKeys: keys.items.map((w) => wordKey(w.lemma, w.pos)), log });
  log.index = index ? { month: index.month, rebuilt, src: index.src } : null;
  await step('넣은 단어', () => requests(index, keys));
  if (index && FEEDS) await step('뉴스', () => news(index));
  if (index) await step('새 단어', () => candidates(index));
  if (index) await step('뉴스 순위', () => ranks(index));
  if (!DRY) await step('학습 순서', async () => { log.reseq = await api('/api/admin/reseq', { method: 'POST' }); });
} catch (e) {
  log.errors.push(String(e.message || e).slice(0, 300));
}
console.log(JSON.stringify(log));
if (log.errors.length) {
  if (!DRY) await notify('error', 'Wortling 단어 작업 오류', log.errors.slice(0, 5).join('\n'));
  process.exitCode = 1;
}

/** 내가 넣은 단어: 기본형 판정 → 있으면 앞으로(exists), 없으면 카드 만들어 앞으로(added), 못 쓰면 rejected */
async function requests(index, keys) {
  const q = (await api('/api/admin/requests?status=queued')).items;
  log.requests = { queued: q.length, added: 0, exists: 0, rejected: 0 };
  if (!q.length) return;
  const got = acceptRequests(askJson(requestPrompt(q.map((r) => ({ id: r.id, text: r.text })))), q.map((r) => r.id));
  const have = lowerKeys(keys.items);
  const settle = [];
  const fresh = [];
  for (const r of q) {
    const o = got.get(r.id);
    if (!o) continue; // 답이 없으면 다음 날 다시
    if (!o.keep) {
      settle.push([r.id, { status: 'rejected', note: o.reason }]);
      continue;
    }
    const key = wordKey(o.lemma, o.pos);
    const id = have.get(key.toLowerCase());
    if (id) {
      settle.push([r.id, { status: 'exists', word_id: id }]);
      continue;
    }
    const raw = index ? own(index.daflex, o.lemma.toLowerCase()) : undefined;
    fresh.push({
      req: r.id, key,
      row: {
        lemma: o.lemma, pos: o.pos, gender: o.gender, plural: o.plural, level: cefr3(raw) ?? o.level, level_src: 'mine',
        gloss_ko: o.gloss_ko, gloss_status: 'generated', example_de: o.example_de, example_ko: o.example_ko, example_src: 'gen',
        scene_en: o.scene_en, news_rank: index ? (own(index.leipzig, key) ?? null) : null, pinned: 1,
      },
    });
  }
  for (const [, b] of settle) log.requests[b.status]++;
  log.requests.added = fresh.length;
  if (DRY) return;
  if (fresh.length) {
    await api('/api/admin/words/insert', { method: 'POST', body: { items: fresh.map((f) => f.row) } });
    const after = lowerKeys((await api('/api/admin/keys')).items);
    for (const f of fresh) {
      const id = after.get(f.key.toLowerCase());
      if (id) settle.push([f.req, { status: 'added', word_id: id }]);
    }
  }
  for (const [id, body] of settle) await api(`/api/admin/requests/${id}`, { method: 'POST', body });
}

/** tagesschau·NDR 제목·요약 → 기본형별 기사 수. 0건이면 아무것도 안 쓴다(지난 기록 그대로) */
async function news(index) {
  const arts = [];
  for (const [name, url] of FEED_URLS) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(String(res.status));
      const got = name === 'tagesschau' ? parseTagesschau(await res.json().catch(() => null)) : parseRss(await res.text());
      log.news[name] = got.length;
      arts.push(...got);
    } catch (e) {
      log.news[name] = `실패 ${String(e.message || e).slice(0, 60)}`;
    }
  }
  const counts = countNews(arts, index);
  log.news.keys = counts.size;
  if (!counts.size || DRY) return;
  const items = [...counts].map(([key, v]) => ({ key, n: v.n, url: v.url }));
  for (let i = 0; i < items.length; i += CHUNK) await api('/api/admin/news', { method: 'POST', body: { day, items: items.slice(i, i + CHUNK) } });
}

/** 새 단어: 후보 → claude 카드 글(keep 판정) → 넣기 · 뺀 것은 word_skips 로 */
async function candidates(index) {
  const keys = await api('/api/admin/keys');
  const hits = new Map((await api(`/api/admin/news?since=${addDays(day, -29)}`)).items.map((x) => [x.key, { n: x.n, url: x.url }]));
  const picks = pickCandidates({ index, have: new Set(keys.items.map((w) => wordKey(w.lemma, w.pos).toLowerCase())), skips: new Set(keys.skips), hits, max: MAX });
  log.candidates = picks.length;
  if (!picks.length || DRY) return;
  const list = picks.map((c) => ({ key: c.key, lemma: c.lemma, pos: c.pos, gender: own(index.facts, c.key)?.g?.[0] ?? null, level: c.level, gloss_en: own(index.facts, c.key)?.en ?? null }));
  const done = new Map(acceptContent(askJson(contentPrompt(list, 'German news-frequency lists')), list).map((x) => [x.key, x]));
  const items = [];
  const skips = [];
  for (const c of picks) {
    const o = done.get(c.key);
    if (!o) continue;
    if (!o.keep) {
      skips.push({ key: c.key, reason: o.reason });
      continue;
    }
    const f = own(index.facts, c.key);
    items.push({
      lemma: c.lemma, pos: c.pos, gender: f?.g?.[0] ?? null, plural: f?.pl ?? null, level: c.level, level_src: 'news',
      gloss_en: f?.en ?? null, gloss_ko: o.gloss_ko, gloss_status: 'generated', example_de: o.example_de, example_ko: o.example_ko,
      example_src: 'gen', scene_en: o.scene_en, news_rank: c.rank,
    });
  }
  if (items.length) log.added = (await api('/api/admin/words/insert', { method: 'POST', body: { items } })).inserted;
  if (skips.length) await api('/api/admin/skips', { method: 'POST', body: { items: skips } });
  log.skipped = skips.length;
}

/** 덱 단어의 Leipzig 순위(news_rank) — 바뀐 것만 */
async function ranks(index) {
  const items = (await api('/api/admin/keys')).items;
  const changed = items
    .map((w) => ({ id: w.id, news_rank: own(index.leipzig, wordKey(w.lemma, w.pos)) ?? null, was: w.news_rank ?? null }))
    .filter((x) => x.news_rank !== x.was)
    .map(({ id, news_rank }) => ({ id, news_rank }));
  log.ranks = changed.length;
  if (DRY) return;
  for (let i = 0; i < changed.length; i += CHUNK) await api('/api/admin/words', { method: 'POST', body: { items: changed.slice(i, i + CHUNK) } });
}
```

- [ ] **Step 3: 문법 + 실제 뉴스로 수 세기**(서버 주소는 Task 9 배포 뒤에 생긴다 → 전체 마른 실행은 Task 9 Step 6). 여기선 Task 5 에서 만든 색인으로 실제 tagesschau·NDR 을 세어 본다(서버에 아무것도 안 씀, 기본형 열쇠만 출력).

Run:
```bash
node --check scripts/admin.mjs && node --check scripts/words/news.mjs
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { parseTagesschau, parseRss, countNews } from './scripts/words/lib.mjs';
const ix = JSON.parse(readFileSync('.data/words-src/index.json', 'utf8'));
const ts = parseTagesschau(await (await fetch('https://www.tagesschau.de/api2u/news')).json());
const ndr = parseRss(await (await fetch('https://www.ndr.de/fernsehen/barrierefreie_angebote/leichte_sprache/nachrichtenleichtesprache100~rss2.xml')).text());
const m = countNews([...ts, ...ndr], ix);
console.log({ ts: ts.length, ndr: ndr.length, keys: m.size, top: [...m].sort((a, b) => b[1].n - a[1].n).slice(0, 15).map(([k, v]) => k + ':' + v.n) });
"
```
Expected: `ts` > 100, `ndr` > 5, `keys` > 200, `top` 이 뉴스다운 명사·동사(예: `Polizei|noun`, `sagen|verb`) — 관사·전치사가 상위면 색인 forms 가 잘못된 것(멈추고 보고).

- [ ] **Step 4: Commit**

```bash
git add scripts/admin.mjs scripts/words/news.mjs
git commit -m "feat(words): 매일 작업 1/2 — 내가 넣은 단어 · 뉴스 신호 · 새 단어 · 학습 순서

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 매일 작업 2/2 `scripts/words/review.mjs`

**Files:**
- Create: `scripts/words/review.mjs`

**Interfaces:**
- Consumes: `askJson`, `api` `notify` `kstDay` `requireEnv` `ROOT`, lib 의 `acceptVerdicts` `decide` `factsFor` `reviewPrompt` `summaryText`; 주소 `GET /api/admin/review-queue` · `POST /api/admin/words` · `GET /api/admin/review-stats`
- Produces: 실행 `node scripts/words/review.mjs [--dry] [--max=N]`

- [ ] **Step 1: 구현** — `scripts/words/review.mjs`

```js
// 매일 단어 작업 2/2(words.yml, news.mjs 다음): 카드 검토 — 고르기(서버) → 기계 근거(색인) → claude 25개씩 → decide → 고치기·기록.
// 설계 docs/superpowers/specs/2026-10-15-word-review-news-design.md 「2. 검토 규칙」
// 옵션: --dry(서버에 안 씀, 앞 10건 판정을 보여 줌) · --max=N(하루 검토 수, 기본 250)
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { askJson } from '../claude.mjs';
import { ROOT, api, kstDay, notify, requireEnv } from '../admin.mjs';
import { acceptVerdicts, decide, factsFor, reviewPrompt, summaryText } from './lib.mjs';

const DRY = process.argv.includes('--dry');
const MAX = Number((process.argv.find((a) => a.startsWith('--max=')) || '').slice(6)) || 250;
const BATCH = 25;
const INDEX_FILE = path.join(ROOT, '.data', 'words-src', 'index.json');

const log = { day: kstDay(), dry: DRY, queued: 0, checked: 0, applied: 0, flagged: 0, failedBatches: 0, errors: [], notes: [] };
const sample = [];

try {
  requireEnv();
  let index = null;
  try {
    index = existsSync(INDEX_FILE) ? JSON.parse(readFileSync(INDEX_FILE, 'utf8')) : null;
  } catch {
    index = null;
  }
  if (!index) log.notes.push('색인 없음 — 관사·복수·레벨은 고치지 않고 확인 필요로');
  const queue = (await api(`/api/admin/review-queue?limit=${MAX}`)).items;
  log.queued = queue.length;
  let fails = 0;
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    const facts = new Map(batch.map((w) => [w.id, factsFor(w, index)]));
    let verdicts;
    try {
      verdicts = acceptVerdicts(askJson(reviewPrompt(batch, (w) => facts.get(w.id))), batch.map((w) => w.id));
      fails = 0;
    } catch (e) {
      log.failedBatches++;
      log.errors.push(`묶음 ${i / BATCH + 1}: ${String(e.message || e).slice(0, 150)}`);
      if (++fails >= 3) {
        log.errors.push('3묶음 연속 실패 — 오늘 검토 멈춤');
        break;
      }
      continue;
    }
    const items = [];
    for (const w of batch) {
      const v = verdicts.get(w.id);
      if (!v) continue; // 답이 없으면 checked 안 됨 → 다음에 다시
      const d = decide(w, facts.get(w.id), v, new Set(w.reverted));
      log.checked++;
      log.applied += d.changes.filter((c) => c.applied).length;
      log.flagged += d.changes.filter((c) => !c.applied).length;
      if (DRY && d.changes.length && sample.length < 10) sample.push({ lemma: w.lemma, changes: d.changes });
      items.push({
        id: w.id,
        ...d.patch,
        ...(w.gloss_status === 'mine' ? {} : { gloss_status: 'checked' }),
        checked: true,
        image_reset: d.meaningChanged,
        close_reports: Boolean(w.report),
        changes: d.changes.map((c) => ({ ...c, source: w.report ? 'report' : 'review' })),
      });
    }
    if (!DRY && items.length) await api('/api/admin/words', { method: 'POST', body: { items } });
  }
  // 일요일(KST)엔 주간 요약
  if (!DRY && new Date(Date.now() + 9 * 3600 * 1000).getUTCDay() === 0) {
    await notify('done', 'Wortling 단어 주간 요약', summaryText(await api('/api/admin/review-stats')));
  }
} catch (e) {
  log.errors.push(String(e.message || e).slice(0, 300));
}
console.log(JSON.stringify(log));
if (DRY) for (const x of sample) console.log(`· ${x.lemma}: ${x.changes.map((c) => `${c.field} ${c.applied ? '바꿈' : '확인 필요'} ${c.old ?? ''} → ${c.new ?? ''} (${c.why})`).join(' | ')}`);
if (log.errors.length) {
  if (!DRY) await notify('error', 'Wortling 카드 검토 오류', log.errors.slice(0, 5).join('\n'));
  process.exitCode = 1;
}
```

- [ ] **Step 2: 문법 확인**(실제 마른 실행은 Task 9 Step 6 — 배포 뒤 운영 서버를 읽기만)

Run: `node --check scripts/words/review.mjs && npm test`
Expected: 오류 0, 시험 PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/words/review.mjs
git commit -m "feat(words): 매일 작업 2/2 — 카드 검토(기계 근거 + claude 판정 + 자동 적용 규칙)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 앱 — 「이상해요」 · 「단어 넣기」(공유하기) · 「고친 카드」

**Files:**
- Create: `src/share.ts`, `src/Report.tsx`, `src/AddWord.tsx`, `src/screens/Changes.tsx`
- Modify: `src/api.ts:123-143`, `src/main.tsx:7-10`, `src/App.tsx`(import · switch · tab), `src/screens/Today.tsx`(`.tophint`), `src/screens/WordDetail.tsx`(article 뒤), `src/screens/Words.tsx`(props · AddWord), `src/screens/Settings.tsx`(링크), `src/mock.ts`(mockHandle), `src/app.css`(끝), `public/manifest.webmanifest`, `scripts/gates/ui.mjs:18`(ROUTES)
- Test: `tests/words-lib.test.mjs`(fromShare)

**Interfaces:**
- Consumes: `REQ_TEXT`, 형 `ReportKind` `ReportRequest` `WordRequestItem` `WordRequestsResponse` `RequestStatus` `ChangeItem` `ChangesResponse`, 주소 Task 3
- Produces: `fromShare(q: URLSearchParams) → {word, url} | null`, `takeShareFromUrl()`, `ReportButton({wordId, lemma})`, `AddWord({initialWord, initialUrl})`, 화면 `#/changes`

- [ ] **Step 1: 실패하는 시험** — `tests/words-lib.test.mjs` 끝에

```js
import { fromShare } from '../src/share.ts';

test('fromShare: 공유 글에서 주소는 링크로, 단어 꼴이 아니면 단어 칸은 비움 (Review Focus 3)', () => {
  const q = (o) => new URLSearchParams(o);
  assert.equal(fromShare(q({})), null);
  assert.deepEqual(fromShare(q({ text: 'Ermittlung' })), { word: 'Ermittlung', url: '' });
  assert.deepEqual(fromShare(q({ title: 'Prozess in Hamburg | NDR.de', text: 'https://www.ndr.de/a' })), { word: '', url: 'https://www.ndr.de/a' });
  assert.deepEqual(fromShare(q({ text: 'Ermittlung https://www.dw.com/de/x', url: '' })), { word: 'Ermittlung', url: 'https://www.dw.com/de/x' });
  assert.deepEqual(fromShare(q({ text: 'Die Polizei ermittelt seit Tagen gegen mehrere Verdächtige wegen eines Vorfalls in Hamburg', url: 'https://www.tagesschau.de/x' })),
    { word: '', url: 'https://www.tagesschau.de/x' });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/words-lib.test.mjs`
Expected: FAIL — `Cannot find module '…/src/share.ts'`

- [ ] **Step 3: 공유하기** — `src/share.ts`

```ts
// 폰 공유하기(manifest share_target: /?title=&text=&url=) → 단어 화면 「단어 넣기」 칸.
// 공유 글에 주소가 섞여 오면 떼어 링크 칸으로, 남은 글이 단어 꼴이 아니면 단어 칸은 비운다.
import { REQ_TEXT } from '../shared/request.ts'

export function fromShare(q: URLSearchParams): { word: string; url: string } | null {
  const title = q.get('title') ?? ''
  const text = q.get('text') ?? ''
  const link = q.get('url') ?? ''
  if (!title && !text && !link) return null
  const url = link.startsWith('https://') ? link : ((text + ' ' + title).match(/https:\/\/\S+/)?.[0] ?? '')
  const rest = text.replace(/https?:\/\/\S+/g, ' ').trim().replace(/\s+/g, ' ')
  return { word: REQ_TEXT.test(rest) ? rest : '', url }
}

/** 공유로 열렸으면 주소의 ?title·text·url 을 지우고 #/words?add=…&url=… 로 */
export function takeShareFromUrl() {
  const sh = fromShare(new URLSearchParams(location.search))
  if (!sh) return
  const q = new URLSearchParams({ add: sh.word, url: sh.url, open: '1' })
  history.replaceState(null, '', location.pathname + '#/words?' + q.toString())
}
```

`src/main.tsx`: `import { takeTokenFromUrl } from './api.ts'` 다음 줄에 `import { takeShareFromUrl } from './share.ts'`, `takeTokenFromUrl()` 다음 줄에 `takeShareFromUrl()`.

`public/manifest.webmanifest` 의 `"scope": "/",` 다음 줄에:

```json
  "share_target": { "action": "/", "method": "GET", "params": { "title": "title", "text": "text", "url": "url" } },
```

- [ ] **Step 4: api** — `src/api.ts` import 형 목록에 `ChangesResponse, ReportRequest, WordRequestsResponse` 를 더하고 `api` 객체 끝(`pushUnsubscribe` 다음)에:

```ts
  /** 「이상해요」 → 다음 검토 때 먼저 */
  report: (id: string, body: ReportRequest) => request<{ ok: boolean }>('POST', `/api/words/${encodeURIComponent(id)}/report`, body),
  requests: () => request<WordRequestsResponse>('GET', '/api/requests'),
  addRequest: (text: string, url?: string) =>
    request<{ ok: boolean; id: number; duplicate: boolean }>('POST', '/api/requests', { text, ...(url ? { url } : {}) }),
  changes: () => request<ChangesResponse>('GET', '/api/changes'),
  revertChange: (id: number) => request<{ ok: boolean }>('POST', `/api/changes/${id}/revert`),
```

- [ ] **Step 5: 「이상해요」** — `src/Report.tsx`

```tsx
// 「이상해요」(덱 · 단어 상세): 어디가 이상한지 고르고 한 줄 메모 → 다음 새벽 검토가 맨 먼저 본다
import { useRef, useState } from 'react'
import { Button, Chip, TextField } from '@montage-ui/core'
import type { ReportKind } from '../shared/api.ts'
import { api, errorText } from './api.ts'
import { useToaster } from './ui.tsx'

const KINDS: Array<[ReportKind, string]> = [
  ['meaning', '뜻'],
  ['example', '예문'],
  ['gender', '관사·복수'],
  ['level', '레벨'],
  ['image', '그림'],
  ['other', '기타'],
]

export function ReportButton({ wordId, lemma }: { wordId: string; lemma: string }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const [kind, setKind] = useState<ReportKind>('meaning')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToaster()
  const close = () => dlg.current?.close()
  const send = async () => {
    setBusy(true)
    try {
      await api.report(wordId, { kind, ...(note.trim() ? { note: note.trim() } : {}) })
      close()
      setNote('')
      toast('고마워요. 내일 아침 전에 다시 볼게요.', 'positive')
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" className="revonly" onClick={(e) => { e.stopPropagation(); dlg.current?.showModal() }}>
        이상해요
      </button>
      <dialog ref={dlg} className="report-dlg" aria-label={`${lemma} 이상한 곳 알리기`} onClick={(e) => e.target === dlg.current && close()}>
        <h2>
          <span lang="de">{lemma}</span> 어디가 이상해요?
        </h2>
        <div className="chips wrap" role="group" aria-label="이상한 곳">
          {KINDS.map(([k, l]) => (
            <Chip key={k} size="small" variant="outlined" active={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {l}
            </Chip>
          ))}
        </div>
        <TextField placeholder="한 줄 메모(선택)" aria-label="메모" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="report-act">
          <Button variant="outlined" color="assistive" onClick={close}>닫기</Button>
          <Button loading={busy} onClick={send}>보내기</Button>
        </div>
      </dialog>
    </>
  )
}
```

`src/screens/Today.tsx`: import 에 `import { ReportButton } from '../Report.tsx'`, `.tophint` 안 `<span className="counter num" …>` 바로 앞에:

```tsx
        {s.queue[s.index] && <ReportButton key={s.queue[s.index].word.id} wordId={s.queue[s.index].word.id} lemma={s.queue[s.index].word.lemma} />}
```

`src/screens/WordDetail.tsx`: import 에 `import { ReportButton } from '../Report.tsx'`, `</article>` 바로 다음 줄에:

```tsx
            <div className="report-row">
              <ReportButton wordId={d.word.id} lemma={d.word.lemma} />
            </div>
```

- [ ] **Step 6: 「단어 넣기」** — `src/AddWord.tsx`

```tsx
// 「단어 넣기」: 기사에서 만난 단어(활용형도 됨) + 링크 → 다음 새벽 작업이 카드로 만들어 맨 앞에. 최근 넣은 10개 상태.
import { useEffect, useState } from 'react'
import { Button, ContentBadge, TextField } from '@montage-ui/core'
import type { RequestStatus, WordRequestItem } from '../shared/api.ts'
import { REQ_TEXT } from '../shared/request.ts'
import { api, errorText } from './api.ts'
import { linkTo } from './router.ts'
import { useToaster } from './ui.tsx'

const STATUS: Record<RequestStatus, string> = { queued: '내일 아침 전', added: '카드 만듦', exists: '이미 있음 · 앞으로', rejected: '제외' }

export function AddWord({ initialWord = '', initialUrl = '', initialOpen = false }: { initialWord?: string; initialUrl?: string; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const [word, setWord] = useState(initialWord)
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState(false)
  const [list, setList] = useState<WordRequestItem[] | null>(null)
  const toast = useToaster()
  const load = () => api.requests().then((r) => setList(r.items), () => setList([]))
  useEffect(() => {
    if (open && list === null) load()
  }, [open, list])
  const w = word.trim()
  const ok = REQ_TEXT.test(w)
  const send = async () => {
    setBusy(true)
    try {
      const r = await api.addRequest(w, url.trim())
      toast(r.duplicate ? '이미 넣어 둔 단어예요.' : '넣었어요. 내일 아침 전에 카드로 만들어요.', 'positive')
      setWord('')
      setUrl('')
      load()
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(false)
    }
  }
  if (!open)
    return (
      <Button size="small" variant="outlined" color="primary" onClick={() => setOpen(true)}>
        단어 넣기
      </Button>
    )
  return (
    <section className="box wh addword" aria-label="단어 넣기">
      <b>기사에서 만난 단어 넣기</b>
      <TextField placeholder="예: Ermittlung · ermittelte" aria-label="넣을 단어" lang="de" value={word} status={w && !ok ? 'negative' : 'normal'} onChange={(e) => setWord(e.target.value)} />
      <TextField type="url" inputMode="url" placeholder="기사 링크(선택)" aria-label="기사 링크" value={url} onChange={(e) => setUrl(e.target.value)} />
      {w && !ok && <p className="small muted">글자로 된 단어 하나(60자 이내)만 넣어 주세요.</p>}
      <Button fullWidth loading={busy} disabled={!ok} onClick={send}>
        넣기
      </Button>
      {list && list.length > 0 && (
        <ul className="reqs">
          {list.map((r) => (
            <li key={r.id} className="kv">
              {r.word_id ? <a {...linkTo('/word/' + r.word_id)} lang="de">{r.lemma ?? r.text}</a> : <span lang="de">{r.text}</span>}
              <ContentBadge size="xsmall" variant="outlined" color="neutral">{STATUS[r.status]}</ContentBadge>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

`src/screens/Words.tsx`: import 에 `import { AddWord } from '../AddWord.tsx'`, 함수 머리를

```tsx
export default function Words({ add = '', url = '', open = false }: { add?: string; url?: string; open?: boolean }) {
```

로, `<main className="page">` 바로 다음 줄에

```tsx
        <AddWord key={add + '|' + url} initialWord={add} initialUrl={url} initialOpen={open || Boolean(add || url)} />
```

`src/App.tsx`: `case 'words':` 의 `screen = <Words />` 를

```tsx
      screen = <Words add={route.query.get('add') ?? ''} url={route.query.get('url') ?? ''} open={route.query.get('open') === '1'} />
```

- [ ] **Step 7: 「고친 카드」** — `src/screens/Changes.tsx`

```tsx
// 고친 카드: 매일 새벽 검토가 바꾼 것(되돌리기) · 확인 필요(근거가 엇갈려 안 바꾼 것)
import { useState } from 'react'
import { Button, Skeleton } from '@montage-ui/core'
import type { ChangeItem } from '../../shared/api.ts'
import { api, errorText } from '../api.ts'
import { fmtDate } from '../format.ts'
import { useAsync } from '../hooks.ts'
import { linkTo } from '../router.ts'
import { Emoji, ErrorBox, Top, useToaster } from '../ui.tsx'

const FIELD: Record<string, string> = { gloss_ko: '뜻', example_de: '예문', example_ko: '예문 번역', gender: '관사', plural: '복수', level: '레벨', note: '메모' }

function Row({ c, onRevert, busy = false }: { c: ChangeItem; onRevert?: () => void; busy?: boolean }) {
  return (
    <li>
      <div className="kv">
        <a {...linkTo('/word/' + c.word_id)} lang="de">
          <b>{c.lemma}</b>
        </a>
        <span className="small muted">{FIELD[c.field] ?? c.field} · {fmtDate(c.at)}</span>
      </div>
      {c.field !== 'note' && (
        <p className="diff">
          <del>{c.old ?? '없음'}</del> → <span>{c.new ?? '없음'}</span>
        </p>
      )}
      {c.why && <p className="small muted">{c.why}</p>}
      {c.applied === 1 &&
        (c.reverted_at ? (
          <span className="small muted">되돌림 · {fmtDate(c.reverted_at)}</span>
        ) : (
          onRevert && (
            <Button size="small" variant="outlined" color="assistive" loading={busy} onClick={onRevert}>
              되돌리기
            </Button>
          )
        ))}
    </li>
  )
}

export default function Changes() {
  const r = useAsync(() => api.changes(), [])
  const toast = useToaster()
  const [busy, setBusy] = useState<number | null>(null)
  const revert = async (c: ChangeItem) => {
    setBusy(c.id)
    try {
      await api.revertChange(c.id)
      toast(`${c.lemma} ${FIELD[c.field] ?? c.field}을 되돌렸어요.`, 'positive')
      r.reload()
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(null)
    }
  }
  const items = r.data?.items ?? []
  const flagged = items.filter((c) => !c.applied)
  const applied = items.filter((c) => c.applied)
  return (
    <>
      <Top title="고친 카드" back="/settings" />
      <main className="page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !r.data ? (
          <Skeleton variant="rectangle" width="100%" height={160} radius={16} />
        ) : items.length === 0 ? (
          <div className="empty">
            <Emoji name="study" size={120} />
            <h2>아직 고친 카드가 없어요</h2>
            <p>매일 새벽 카드를 검토해요. 바꾼 게 생기면 여기에 보여요.</p>
          </div>
        ) : (
          <>
            {flagged.length > 0 && (
              <>
                <h3 className="sec-t">확인 필요 · {flagged.length}</h3>
                <ul className="box wh chg">
                  {flagged.map((c) => <Row key={c.id} c={c} />)}
                </ul>
              </>
            )}
            <h3 className="sec-t">고친 것 · {applied.length}</h3>
            <ul className="box wh chg">
              {applied.map((c) => <Row key={c.id} c={c} busy={busy === c.id} onRevert={() => revert(c)} />)}
            </ul>
          </>
        )}
      </main>
    </>
  )
}
```

`src/App.tsx`: `import Changes from './screens/Changes.tsx'`, switch 에 `case 'changes': screen = <Changes />; break`(다른 case 와 같은 꼴), tab 줄의 목록 `['onboarding', 'inbox', 'settings', 'setup']` 에 `'changes'` 를 더한다.

`src/screens/Settings.tsx`: 첫 `<a className="box wh linkrow" {...linkTo('/setup')}>…</a>` 바로 다음에

```tsx
        <a className="box wh linkrow" {...linkTo('/changes')}>
          <span>
            고친 카드
            <small className="sub">매일 새벽 검토가 바꾼 뜻·예문 · 되돌리기</small>
          </span>
          <IconChevronRight aria-hidden />
        </a>
```

- [ ] **Step 8: 모양(CSS)** — `src/app.css` 끝에

```css
/* 「이상해요」 창(native dialog) */
.report-dlg {
  border: 0;
  border-radius: 20px;
  padding: 20px;
  width: min(calc(100vw - 32px), 420px);
  background: var(--paper);
  color: var(--ink);
}
.report-dlg::backdrop {
  background: rgb(0 0 0 / 0.35);
}
.report-dlg h2 {
  font-size: 17px;
  margin: 0 0 12px;
  word-break: keep-all;
}
.chips.wrap {
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.report-act {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}
.report-row {
  display: flex;
  justify-content: flex-end;
}
/* 「단어 넣기」 · 고친 카드 */
.addword {
  display: grid;
  gap: 8px;
}
.reqs,
.chg {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.reqs li {
  padding: 6px 0;
}
.chg li {
  display: grid;
  gap: 4px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.chg li:last-child {
  border-bottom: 0;
}
.chg .diff {
  margin: 0;
  font-size: 13.5px;
  color: var(--ink2);
  word-break: keep-all;
  overflow-wrap: anywhere;
}
.chg .diff del {
  color: var(--ink3);
}
```

- [ ] **Step 9: 목업(게이트용)** — `src/mock.ts`: import 형에 `ChangeItem, WordRequestItem` 을 더하고, `mockHandle` 위에 자료를, `mockHandle` 안 `if (p === '/api/inbox') …` 앞에 응답을 더한다.

```ts
const requests: WordRequestItem[] = [
  { id: 2, text: 'ermittelte', url: 'https://www.dw.com/de/x', created_at: ago(0), status: 'queued', word_id: null, lemma: null, note: null },
  { id: 1, text: 'Umzug', url: null, created_at: ago(1), status: 'exists', word_id: 'w002', lemma: 'Umzug', note: null },
]
const changes: ChangeItem[] = [
  { id: 2, word_id: 'w004', lemma: 'Entscheidung', field: 'level', old: 'B1', new: 'B2', why: '검토 판정 · 안 바꿈: DAFlex: B1', source: 'review', applied: 0, reverted_at: null, at: ago(0) },
  { id: 1, word_id: 'w002', lemma: 'Umzug', field: 'gloss_ko', old: '이동', new: '이사', why: '주된 뜻은 이사', source: 'report', applied: 1, reverted_at: null, at: ago(0) },
]
```

```ts
  if (/^\/api\/words\/[\w-]+\/report$/.test(p) && method === 'POST') return { ok: true, id: 1 }
  if (p === '/api/requests' && method === 'GET') return { items: requests }
  if (p === '/api/requests' && method === 'POST') {
    const b = body as { text: string; url?: string }
    requests.unshift({ id: requests.length + 1, text: b.text, url: b.url ?? null, created_at: iso(now()), status: 'queued', word_id: null, lemma: null, note: null })
    return { ok: true, id: requests.length, duplicate: false }
  }
  if (p === '/api/changes') return { items: changes }
  if (/^\/api\/changes\/\d+\/revert$/.test(p) && method === 'POST') {
    const c = changes.find((x) => x.id === Number(p.split('/')[3]))
    if (c) c.reverted_at = iso(now())
    return { ok: true }
  }
```

`scripts/gates/ui.mjs` 18줄 `ROUTES` 끝에 `'/changes', '/words?add=Ermittlung&url=https%3A%2F%2Fwww.dw.com%2Fde%2Fx'` 를 더한다.

- [ ] **Step 10: 확인** — 시험 · 형 · 빌드 · 화면 게이트

Run: `node --test tests/words-lib.test.mjs && npm test && npm run build && npm run gate`
Expected: 시험 PASS · `tsc -b` 오류 0 · 게이트: 새 두 경로 포함 모든 경로 390/1280 × light/dark 에서 가로 넘침 0 · 콘솔 오류 0. 게이트 스크린숏(`scripts/gates/shots/`)에서 `/changes`·`/words?add=…` 를 눈으로 본다(「단어 넣기」 칸이 열려 단어·링크가 채워져 있어야 함).

- [ ] **Step 11: Commit**

```bash
git add src/share.ts src/Report.tsx src/AddWord.tsx src/screens/Changes.tsx src/api.ts src/main.tsx src/App.tsx src/screens/Today.tsx src/screens/WordDetail.tsx src/screens/Words.tsx src/screens/Settings.tsx src/mock.ts src/app.css public/manifest.webmanifest scripts/gates/ui.mjs tests/words-lib.test.mjs
git commit -m "feat(app): 「이상해요」 신고 · 「단어 넣기」(폰 공유하기) · 고친 카드 되돌리기

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 운영 — words.yml · PC 작업 정리 · README · 배포 · 첫 실행

**Files:**
- Create: `.github/workflows/words.yml`
- Modify: `scripts/register-task.ps1`, `README.md`

**Interfaces:**
- Consumes: 비밀값 `APP_URL` `API_TOKEN` `CLAUDE_CODE_OAUTH_TOKEN` `DISCORD_WEBHOOK_URL`(daily.yml 과 같은 것, 이미 등록됨)

- [ ] **Step 1: 워크플로** — `.github/workflows/words.yml`

```yaml
# 매일 단어 작업(카드 검토 · 뉴스 단어 · 내가 넣은 단어 · 학습 순서)을 깃허브 서버에서 — PC 가 꺼져 있어도 돈다.
# 07:30 아침 알림 전에 오늘 볼 카드를 검토해 두려고 05:17 KST. 그림 작업(daily.yml 12:17)과 안 겹친다.
# 설계 docs/superpowers/specs/2026-10-15-word-review-news-design.md
# 비밀값: APP_URL · API_TOKEN · CLAUDE_CODE_OAUTH_TOKEN · DISCORD_WEBHOOK_URL (daily.yml 과 같음)
# 색인(.data/words-src/index.json)은 Actions 캐시에 달마다. 공개 저장소라 아무것도 커밋하지 않는다.
name: words

on:
  schedule:
    - cron: '17 20 * * *' # 한국 05:17
  workflow_dispatch:
    inputs:
      dry:
        description: '서버에 쓰지 않고 수만(--dry)'
        type: boolean
        default: false

concurrency: words

permissions:
  contents: read

jobs:
  words:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    env:
      APP_URL: ${{ secrets.APP_URL }}
      API_TOKEN: ${{ secrets.API_TOKEN }}
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
      DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
      DRY: ${{ inputs.dry && '--dry' || '' }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: claude CLI
        run: npm i -g @anthropic-ai/claude-code
      - id: month
        run: echo "m=$(date -u +%Y-%m)" >> "$GITHUB_OUTPUT"
      - uses: actions/cache@v4
        with:
          path: .data/words-src/index.json
          key: words-src-${{ steps.month.outputs.m }}
          restore-keys: words-src-
      - name: news.mjs (넣은 단어 · 뉴스 · 새 단어 · 순서)
        run: node scripts/words/news.mjs $DRY
      - name: review.mjs (카드 검토)
        if: always()
        run: node scripts/words/review.mjs $DRY
```

- [ ] **Step 2: PC 작업 정리** — `scripts/register-task.ps1` 를 아래로 통째로 바꾼다(첫 줄 BOM 은 Write 가 지워도 된다 — 한글은 주석뿐이라 PowerShell 5.1 에서도 안전; 걱정되면 저장 뒤 `powershell -File` 로 한 번 돌려 확인).

```powershell
# Windows 작업 스케줄러에 작업 하나를 등록한다(놓치면 켜질 때 바로).
#   「Wortling Backup」 평일 12:00  node scripts\daily.mjs --no-text --no-image — D1 백업만(공개 저장소라 서버에서 안 함)
#   글 채우기·그림은 .github/workflows/daily.yml(매일 12:17), 단어 검토·새 단어는 .github/workflows/words.yml(매일 05:17) — PC 가 꺼져 있어도 돈다
# 실행: powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1   (지우기: -Remove)
param([switch]$Remove, [string]$At = "12:00")

$daily = "Wortling Backup"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command node).Source
$old = @("Wortling Daily", "Wortling Words")   # 서버로 옮긴 옛 작업

if ($Remove) {
  foreach ($name in @($daily) + $old) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "removed: $name"
  }
  exit 0
}

foreach ($name in $old) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue }
$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\daily.mjs --no-text --no-image" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $daily -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "registered: $daily weekdays at $At ($root)"
```

Run: `powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1` 그리고 `Get-ScheduledTask | Where-Object TaskName -like 'Wortling*'`
Expected: `Wortling Backup` 하나만 남음.

- [ ] **Step 3: README** — 「구성」 표에서 `scripts/daily.mjs` 줄 아래에 두 줄을 더하고, 문서 끝에 출처 절을 더한다.

```markdown
| `scripts/words/` | **매일 서버에서**(`.github/workflows/words.yml`, 05:17) 카드 검토(뜻·예문·번역·관사·레벨, 자동 고침 + 기록·되돌리기) · 내가 넣은 단어 · 뉴스 단어 추가 · 학습 순서 |
| `scripts/words/update.mjs` | 손으로 돌리는 예전 단어 갱신(WordHoard·DWDS, PC 전용) |
```

```markdown
## 단어 자료 출처 · 라이선스

| 자료 | 쓰는 곳 | 라이선스 |
|---|---|---|
| [Leipzig Corpora Collection](https://wortschatz-leipzig.de/) 독일어 뉴스 300K | 뉴스에 자주 나오는 단어 · 학습 순서 | CC BY |
| [kaikki.org](https://kaikki.org/) 독일어(영어판 Wiktionary 추출) | 활용형 → 기본형 · 관사·복수 대조 | CC BY-SA |
| [DAFlex](https://cental.uclouvain.be/cefrlex/daflex/) (UCLouvain) | 레벨 대조 · A1/A2 거르기 | CC BY-NC-SA 4.0 — 비영리, 파생 자료는 저장소에 안 올림 |
| tagesschau API · NDR 쉬운 말 RSS | 최근 30일 기사에 나온 기본형 수(글은 저장 안 함, 링크만) | 개인·비영리 이용, `NEWS_FEEDS=0` 으로 끔 |

KBS World Radio · DW 는 이용 조건상 자동 수집을 하지 않는다 — 앱 「단어 넣기」(폰 공유하기)로 읽다가 만난 단어를 직접 넣는다.
```

- [ ] **Step 4: 전체 확인 + 커밋**

Run: `npm test && npm run typecheck:worker && npm run build`
Expected: 모두 PASS

```bash
git add .github/workflows/words.yml scripts/register-task.ps1 README.md
git commit -m "feat(ops): 매일 단어 작업 words.yml(05:17) · PC 「Wortling Words」 정리 · 자료 출처

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 5: 운영 반영**(되돌리기 어려운 단계 — 순서 그대로)

1. 백업: `node scripts/daily.mjs --no-text --no-image` → `backup/<오늘>.sql.gz` 가 새로 생겼는지 확인.
2. 원격 마이그레이션: `npm run db:migrate:remote` → 「0004_review_news.sql ✅」.
3. 배포: `git status --short` 가 비어 있는지 본 뒤 `npm run deploy`. 배포 직후 새 주소 404 는 퍼짐 지연(수십 초) — 1분 뒤 `curl -s -o /dev/null -w "%{http_code}" "$APP_URL/api/health"` 가 200.

- [ ] **Step 6: PC 마른 실행**(운영 서버를 읽기만 — `--dry` 는 쓰기 0)

Run: `node scripts/words/news.mjs --dry && node scripts/words/review.mjs --dry --max=25`
Expected: news JSON `errors: []`, `candidates` > 0, `news.keys` > 0 · review JSON `queued: 25`, `checked` ≥ 20, `errors: []`, 「· 표제어: … 바꿈/확인 필요 …」 줄들.
**사람 눈 확인**: 「바꿈」 줄이 실제로 틀린 것을 고친 것인지 10건 읽는다. 취향 고침(같은 뜻 다른 말)이 절반을 넘으면 멈추고 보고 — `reviewPrompt` 의 「Be conservative」 를 더 세게 고치고 Task 4 시험을 다시 돌린 뒤 이 단계부터.

- [ ] **Step 7: Actions 첫 실행** — 마른 실행 → 실제 실행

Run: `gh workflow run words.yml -f dry=true && sleep 10 && gh run watch "$(gh run list --workflow=words.yml -L 1 --json databaseId -q '.[0].databaseId')" --exit-status`
Expected: 성공. 로그의 news.mjs JSON 에서 `index.rebuilt: true`, `news.tagesschau` > 0(미국 IP 에서 열림 — 0 이거나 「실패 403」 이면 저장소 변수 `NEWS_FEEDS=0` 을 걸고 사용자에게 알림), `errors: []`; review.mjs JSON `checked` ≈ `queued`.

Run: `gh workflow run words.yml && sleep 10 && gh run watch "$(gh run list --workflow=words.yml -L 1 --json databaseId -q '.[0].databaseId')" --exit-status`
Expected: 성공, `added` ≤ 30, `reseq.moved` > 0, review `checked` ≈ 250.

- [ ] **Step 8: 앱에서 확인** — 폰(또는 PC 브라우저)으로 앱을 열어 ① 설정 → 고친 카드에 목록이 보이고 되돌리기 1건이 되는지 ② 오늘 덱 「이상해요」 → 보내기 토스트 ③ 단어 → 「단어 넣기」에 `ermittelte` 넣기 → 「내일 아침 전」. (선택) 안드로이드에서 기사 공유 → Wortling.

---

## 끝난 뒤

- `superpowers:finishing-a-development-branch`(또는 main 에서 진행했으면 생략)
- 메모리 `project_wortling_german_vocab_plan.md` 갱신: 커밋 · words.yml 시각 · 함정(뉴스 미국 IP 결과 · 색인 크기)
- 디스코드 `done` 알림
