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
import { indexLooksSane, wordKey } from './lib.mjs';

/** 색인 만드는 규칙의 판. 규칙을 바꾸면 올린다 → 같은 달이라도 캐시 색인을 다시 만든다. 2 = 동음 복수형 「모름」(10-15) */
export const INDEX_VERSION = 2;
/** 캐시 색인을 그대로 써도 되나: 이번 달 + 같은 판 */
export const indexFresh = (old, month) => Boolean(old) && old.month === month && old.v === INDEX_VERSION;
export const KAIKKI_URL = 'https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz';
export const DAFLEX_URL = 'https://cental.uclouvain.be/cefrlex/static/resources/de/DAFlex.tsv';
export const leipzigUrl = (year) => `https://downloads.wortschatz-leipzig.de/corpora/deu_news_${year}_300K.tar.gz`;
const UA = 'wortling-words (personal vocabulary app; github.com/0101-commits/worty)';
const POS = new Set(['noun', 'verb', 'adj', 'adv']);
const FUNCTION_POS = new Set(['article', 'det', 'pron', 'prep', 'conj', 'particle', 'num', 'postp', 'contraction', 'intj']);
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

/** DAFlex STTS 품사 → 우리 품사 */
const STTS = (tag) => (tag.startsWith('NN') ? 'noun' : /^V[VAM]/.test(tag) ? 'verb' : tag.startsWith('ADJ') ? 'adj' : tag === 'ADV' ? 'adv' : null);

/** DAFlex → Map(「소문자 낱말|품사」 → 전체 빈도). 겹친 활용형을 기본형에 나눌 때의 기준(교재에 자주 나오는 쪽) */
export function daflexPrior(text) {
  const lines = String(text).split(/\r?\n/);
  const head = lines[0].split('\t').map((h) => h.replace(/"/g, ''));
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const out = new Map();
  if (col['total_freq@total'] === undefined) return out;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const c = line.split('\t').map((x) => x.replace(/"/g, ''));
    const pos = STTS(c[col.tag] ?? '');
    const n = Number(c[col['total_freq@total']]);
    if (!pos || !(n > 0)) continue;
    const k = `${c[col.word].toLowerCase()}|${pos}`;
    out.set(k, (out.get(k) ?? 0) + n);
  }
  return out;
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

/**
 * kaikki 줄들 → 색인. 말뭉치에 활용형이 하나라도 있거나 덱에 있는 표제어만 담는다(색인 크기 줄이기).
 * forms = 한 낱말 활용형(빈도 셈·뉴스 셈·기본형 찾기), sep = 분리동사 앞 낱말(「rief an」 → rief, 예문 검사에만),
 * fn = 관사·대명사·전치사 등 기능어 글꼴(새 단어 후보에서 동음이의 거르기).
 */
export async function buildIndex({ kaikkiLines, daflexText, leipzigText, deckKeys = [], month, src = {} }) {
  const vocab = parseLeipzig(leipzigText);
  const deck = new Set(deckKeys.map((k) => k.toLowerCase()));
  const forms = new Map();
  const sep = new Map();
  const fn = new Set();
  const facts = new Map();
  const plurals = new Map();
  const put = (m, f, key) => {
    const a = m.get(f) ?? [];
    if (!a.includes(key)) a.push(key);
    m.set(f, a);
  };
  for await (const line of kaikkiLines) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof o.word !== 'string') continue;
    if (FUNCTION_POS.has(o.pos)) {
      for (const w of [o.word, ...(o.forms ?? []).map((f) => f?.form)]) if (typeof w === 'string' && LETTERS.test(w)) fn.add(w);
      continue;
    }
    if (!POS.has(o.pos) || !LETTERS.test(o.word)) continue;
    if ((o.senses ?? []).some((x) => x.form_of || x.alt_of)) continue; // 활용형 자체 항목(「Umzüge」 = Umzug 의 복수)
    const key = wordKey(o.word, o.pos);
    const fs = new Set([o.word]);
    const sp = new Set();
    for (const f of o.forms ?? []) {
      if (typeof f?.form !== 'string' || (f.tags ?? []).some((t) => SKIP_TAGS.has(t))) continue;
      const parts = f.form.split(' ');
      if (parts.length === 1 && LETTERS.test(parts[0])) fs.add(parts[0]);
      // 분리동사 「rief an」 → rief: 뒷 낱말이 표제어의 앞붙이(anrufen = an + rufen)일 때만.
      // 「zu betrüben」·「habe betrübt」·「viel sagend」 의 앞 낱말(zu·habe·viel)은 활용형이 아니다(10-15 실측: 순위 1위가 betrübend 였음).
      // 빈도 셈에는 안 넣는다 — 「wird los」 의 wird 가 loswerden 순위를 werden 만큼 올렸다(10-15 실측)
      else if (parts.length === 2 && LETTERS.test(parts[0]) && LETTERS.test(parts[1])
        && o.word.toLowerCase().startsWith(parts[1].toLowerCase()) && o.word.length >= parts[1].length + 3) sp.add(parts[0]);
    }
    const inDeck = deck.has(key.toLowerCase());
    if (!inDeck && ![...fs].some((f) => vocab.has(f))) continue;
    for (const f of fs) if (inDeck || vocab.has(f)) put(forms, f, key);
    for (const f of sp) put(sep, f, key);
    const prev = facts.get(key);
    const en = prev?.en ?? o.senses?.find((x) => x.glosses?.length)?.glosses[0]?.slice(0, 80) ?? null;
    if (o.pos === 'noun') {
      const g = new Set(prev?.g ?? []);
      for (const x of o.senses ?? []) for (const t of x.tags ?? []) if (GENDER[t]) g.add(GENDER[t]);
      // 복수형은 동음 표제어(Bank: Banken / Bänke)마다 모아 두었다가 하나로 같을 때만 쓴다(아래). '' = 복수 없음
      const ps = plurals.get(key) ?? new Set();
      ps.add((o.forms ?? []).find((f) => f.tags?.length === 1 && f.tags[0] === 'plural')?.form ?? '');
      plurals.set(key, ps);
      facts.set(key, { g: [...g], en });
    } else facts.set(key, { en });
  }
  // 복수형: 동음 표제어끼리 다르면 「모름」(칸 없음) — 그 값을 Claude 에게도 보여 주므로, 하나만 고르면 「사전과 같을 때만」 검사가 독립 근거가 아니게 된다
  for (const [key, ps] of plurals) if (ps.size === 1) facts.get(key).pl = [...ps][0] || null;
  // Leipzig 순위: 활용형 횟수를 기본형으로 모은다. 기능어 글꼴(einen = 관사)은 안 센다.
  // 1차 = 한 기본형에만 걸리는 활용형, 2차 = 여러 기본형에 걸친 활용형을 나눔 —
  // DAFlex 품사별 빈도가 있으면 그것에 비례(schon → 부사 schon, 명령형 schonen 아님), 없으면 1차 몫에 비례, 둘 다 0이면 똑같이.
  // 통째로 양쪽에 더했더니 드문 haten 이 hatte(haben) 몫을, schonen 이 schon 몫을 가져갔다(10-15 실측)
  const prior = daflexPrior(daflexText);
  const sure = new Map();
  for (const [f, n] of vocab) {
    const ks = forms.get(f);
    if (ks?.length === 1 && !fn.has(f)) sure.set(ks[0], (sure.get(ks[0]) ?? 0) + n);
  }
  const sum = new Map(sure);
  for (const [f, n] of vocab) {
    const ks = forms.get(f);
    if (!ks || ks.length < 2 || fn.has(f)) continue;
    const p = ks.map((k) => prior.get(k.toLowerCase()) ?? 0);
    const w = p.some((x) => x > 0) ? p : ks.map((k) => sure.get(k) ?? 0);
    const tot = w.reduce((a, b) => a + b, 0);
    ks.forEach((k, i) => sum.set(k, (sum.get(k) ?? 0) + n * (tot ? w[i] / tot : 1 / ks.length)));
  }
  const leipzig = Object.fromEntries([...sum].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k], i) => [k, i + 1]));
  return {
    month, v: INDEX_VERSION, built: new Date().toISOString(), src,
    forms: Object.fromEntries(forms), sep: Object.fromEntries(sep), fn: [...fn].sort(),
    facts: Object.fromEntries(facts), daflex: parseDaflex(daflexText), leipzig,
  };
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
  if (indexFresh(old, month)) return { index: old, rebuilt: false };
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
    // 원본 형식이 바뀌어 거의 빈 색인이 나오면 쓰지 않는다(덱 순위를 통째로 덮지 않게 — 최종 검토 반영)
    if (!indexLooksSane(index)) throw new Error(`색인이 너무 작음 forms ${Object.keys(index.forms).length} · facts ${Object.keys(index.facts).length}`);
    writeFileSync(`${file}.tmp`, JSON.stringify(index));
    renameSync(`${file}.tmp`, file);
    for (const f of readdirSync(dir)) if (f !== 'index.json') rmSync(path.join(dir, f), { recursive: true, force: true });
    return { index, rebuilt: true };
  } catch (e) {
    log.errors.push(`색인 만들기 실패: ${String(e.message || e).slice(0, 200)}`);
    return { index: old, rebuilt: false };
  }
}
