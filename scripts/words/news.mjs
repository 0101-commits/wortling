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
