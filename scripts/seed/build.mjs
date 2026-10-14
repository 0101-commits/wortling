// Wortling 단어장 씨앗 빌더: B1(괴테 목록) + B2·C1(WordHoard → DWDS 대조) → kaikki 보강 + 한국어 내용 파일 → seed/seed.sql + seed/words.json + seed/report.md
// 실행: npm run seed:build   (node 24 표준 라이브러리만 사용)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(HERE, 'data');
const OUT_DIR = path.join(ROOT, 'seed');
// 원본 자료는 저장소 안 .data/(git 제외)에 둔다(scripts/words/update.mjs 가 내려받음). 환경변수로 바꿀 수 있다.
const KAIKKI_DIR = process.env.KAIKKI_DIR
  || path.join(ROOT, '.data', 'kaikki');
const DUE = '2026-10-13T00:00:00Z';
const BATCH = 100;
const POS4 = { NOUN: 'noun', VERB: 'verb', ADJ: 'adj', ADV: 'adv' }; // WordHoard(UPOS) → 우리 pos
const LETTERS = /^[a-zäöüß-]+$/i;
const collator = new Intl.Collator('de');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const lower = (s) => s.toLowerCase();
const key = (lemma, pos) => `${lower(lemma)}|${pos}`;

// ── 1. B1 괴테 목록 ─────────────────────────────────────────────────────────
const b1 = readJson(path.join(DATA, 'b1_goethe.json')).map((w) => ({
  lemma: w.lemma, pos: w.pos, gender: w.gender || null, level: 'B1', level_src: 'goethe',
}));
const b1Keys = new Set(b1.map((w) => key(w.lemma, w.pos)));

// ── 2. WordHoard CSV (빈도 순위 + B2 후보) ───────────────────────────────────
// 따옴표 든 셀이 있을 수 있어 아주 작은 CSV 파서를 쓴다 (한 줄 = 한 행, 셀 안 줄바꿈 없음 확인됨).
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const freqRank = new Map();        // 'lemma|pos' → 순위 (B1 에도 적용)
const rawBy = { B2: [], C1: [] };  // 수준별 후보 원본(WordHoard cefr_estimate)
const b2Raw = rawBy.B2;
{
  const lines = fs.readFileSync(path.join(DATA, 'wordhoard-de.csv'), 'utf8').split(/\r?\n/);
  const head = parseCsvLine(lines[0]);
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const c = parseCsvLine(line);
    const pos = POS4[c[col.pos]];
    if (!pos) continue;
    const lemma = c[col.lemma];
    const rank = Number(c[col.frequency_rank]) || null;
    const k = key(lemma, pos);
    if (!freqRank.has(k)) freqRank.set(k, rank);
    rawBy[c[col.cefr_estimate]]?.push({ lemma, pos, rank });
  }
}

// ── 3. kaikki 스트리밍 (후보 단어만 파싱) ───────────────────────────────────
const candidates = new Set([...b1, ...rawBy.B2, ...rawBy.C1].map((w) => lower(w.lemma)));
const kaikki = new Map(); // 'lemma|pos' → [{word, gender, plural, ipa, glosses[], vulgar}]
const WORD_RE = /"word": "((?:[^"\\]|\\.)*)", "lang": "German"/;

function genderOf(e) {
  const ht = e.head_templates?.[0];
  const m = { m: 'der', f: 'die', n: 'das' };
  const g = ht?.args?.g || ht?.args?.['1'];
  if (g && m[g[0]] && /^[mfn](?:[,.:]|$)/.test(g)) return m[g[0]];
  const x = ht?.expansion?.match(/^\S+ ([mfn])\b/);
  return x ? m[x[1]] : null;
}
function pluralOf(e) {
  const skip = ['genitive', 'dative', 'accusative', 'diminutive'];
  const pl = (e.forms || []).filter((f) => f.tags?.includes('plural') && !f.tags.some((t) => skip.includes(t)));
  return (pl.find((f) => f.tags.includes('nominative')) || pl[0])?.form || null;
}
function glossesOf(e) {
  const out = [];
  for (const s of e.senses || []) {
    const g = s.glosses?.[0];
    if (!g || s.form_of || s.tags?.includes('form-of') || /^(inflection|plural) of /i.test(g)) continue;
    out.push(g);
  }
  return out;
}
async function scanKaikki(file) {
  if (!fs.existsSync(file)) { console.warn('kaikki 파일 없음, 건너뜀:', file); return; }
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    const m = WORD_RE.exec(line);
    const word = m ? JSON.parse(`"${m[1]}"`) : null;
    if (!word || !candidates.has(lower(word))) continue;
    const e = JSON.parse(line);
    const k = key(word, e.pos);
    const list = kaikki.get(k) || [];
    list.push({
      word,
      gender: e.pos === 'noun' ? genderOf(e) : null,
      plural: e.pos === 'noun' ? pluralOf(e) : null,
      ipa: (e.sounds || []).find((s) => s.ipa)?.ipa || null,
      glosses: glossesOf(e),
      vulgar: (e.senses || []).some((s) => s.tags?.includes('vulgar')),
    });
    kaikki.set(k, list);
    n++;
  }
  console.log(`kaikki ${path.basename(file)}: 후보 일치 ${n}건`);
}
for (const p of ['noun', 'verb', 'adj', 'adv']) await scanKaikki(path.join(KAIKKI_DIR, `de-${p}.jsonl`));

// 같은 lemma|pos 에 항목이 여럿(어원 번호별)이면 표기 규칙에 맞는 것을 앞세워 합친다: 명사=대문자 시작, 그 밖=소문자.
function lookup(lemma, pos) {
  const list = kaikki.get(key(lemma, pos));
  if (!list) return null;
  const fits = (w) => (pos === 'noun' ? /^[A-ZÄÖÜ]/.test(w) : w === lower(w));
  const sorted = [...list].sort((a, b) => fits(b.word) - fits(a.word));
  const first = (f) => sorted.map(f).find((v) => v) || null;
  const glosses = [...new Set(sorted.flatMap((e) => e.glosses))];
  let gloss = glosses.slice(0, 2).join('; ');
  if (gloss.length > 80) gloss = glosses[0];
  if (gloss.length > 80) gloss = gloss.slice(0, 79) + '…';
  return {
    word: sorted[0].word, gender: first((e) => e.gender), plural: first((e) => e.plural),
    ipa: first((e) => e.ipa), gloss_en: gloss || null, vulgar: sorted.some((e) => e.vulgar),
  };
}

// ── 4. B2 선별 ───────────────────────────────────────────────────────────────
// DWDS 표제어 목록(lemma,url,wortklasse,artikeldatum,artikeltyp,frequenzklasse). 저장소 밖에 두고 환경변수로 바꿀 수 있다.
const DWDS_CSV = process.env.DWDS_LEMMA_CSV
  || path.join(ROOT, '.data', 'dwds_lemma.csv');
// 없으면 B2 가 조용히 달라지고 id 가 밀리므로 멈춘다.
if (!fs.existsSync(DWDS_CSV)) throw new Error(`DWDS 표제어 목록이 없다: ${DWDS_CSV} (DWDS_LEMMA_CSV 로 경로 지정)`);
const WK = { Substantiv: 'noun', Verb: 'verb', Adjektiv: 'adj', 'partizipiales Adjektiv': 'adj', Adverb: 'adv', Pronominaladverb: 'adv' };
// 표제어(표기 그대로) → Map(pos → 빈도 등급 목록). 위 네 품사가 아닌 항목(접사·고유명사·접속사 등)만 있으면 「DWDS 없음」으로 본다.
const dwds = new Map();
for (const line of fs.readFileSync(DWDS_CSV, 'utf8').split(/\r?\n/).slice(1)) {
  if (!line) continue;
  const [lemma, , wk, , , fk] = parseCsvLine(line);
  const pos = WK[wk];
  if (!pos) continue;
  const m = dwds.get(lemma) || new Map();
  m.set(pos, [...(m.get(pos) || []), fk]);
  dwds.set(lemma, m);
}

// B2 와 C1 에 같은 규칙을 쓴다. 고른 (lemma,pos)는 taken 에 쌓여, C1 은 B1·B2(사람 판정 전) 와 겹치면 「중복」으로 빠진다.
const dropped = { B2: {}, C1: {} }; // 수준 → 사유 → 탈락 표제어 목록
const retagged = { B2: [], C1: [] }; // 수준 → 품사 고침 기록
const taken = new Set(b1Keys);
function select(rawList, level) {
  const drop = (why, lemma) => { (dropped[level][why] ||= []).push(lemma); };
  const out = [];
  for (const w of rawList) {
    if (b1Keys.has(key(w.lemma, w.pos))) { drop('B1 목록에 이미 있음', w.lemma); continue; }
    if (!LETTERS.test(w.lemma)) { drop('글자 아닌 문자 포함', w.lemma); continue; }
    if (w.lemma.length < 3) { drop('3글자 미만', w.lemma); continue; }
    const k = lookup(w.lemma, w.pos);
    if (!k) { drop('kaikki 에 없음(자막 잡음·고유명사)', w.lemma); continue; }
    if (k.vulgar) { drop('kaikki 비속어 태그', w.lemma); continue; }
    // DWDS 대조: 표제어 → 품사 → 빈도 → 중복 순서
    const lemma = k.word;
    let pos = w.pos;
    const d = dwds.get(lemma);
    if (!d) { drop('DWDS 없음', lemma); continue; }
    let re = null; // 고친 뒤 빠지면 표시해 둔다
    if (!d.has(pos)) {
      if (d.size !== 1) { drop('품사 불일치', lemma); continue; }
      pos = [...d.keys()][0];
      // 명사로 고칠 때는 성이 꼭 있어야 한다(kaikki 에 없으면 뺀다)
      if (pos === 'noun' && !lookup(lemma, 'noun')?.gender) { drop('품사 불일치', lemma); continue; }
      re = { lemma, from: w.pos, to: pos };
      retagged[level].push(re);
    }
    if (d.get(pos).every((f) => f === '0' || f === '1')) { drop('드문 단어', lemma); if (re) re.lost = '드문 단어'; continue; }
    const u = key(lemma, pos);
    if (taken.has(u)) { drop('중복', lemma); if (re) re.lost = '중복'; continue; }
    taken.add(u);
    // 품사를 고쳤으면 성·복수·발음·영어 뜻은 5단계에서 새 품사로 kaikki 를 다시 찾는다(없으면 비움). 빈도는 원래 순위를 그대로 둔다.
    out.push({ lemma, pos, gender: null, level, level_src: 'wordhoard', freq_rank: re ? w.rank : undefined });
  }
  return out;
}
const b2 = select(rawBy.B2, 'B2');
const c1 = select(rawBy.C1, 'C1');

// ── 5. 보강 + 정렬 + id ───────────────────────────────────────────────────────
const content = new Map(); // 'lemma|pos'(표기 그대로) → {keep?, gloss_ko, example_de, example_ko, scene_en, reason?}
// content_<b1|b2|c1>_<번호>.json 과 정기 업데이트가 쓰는 content_auto_<날짜>.json 만 읽는다
// (나눠 쓰는 중인 content_b2_1_a.json 같은 조각은 읽지 않음). 이름순으로 읽어 같은 key 는 뒤 파일이 이긴다:
// auto(날짜순) < b1 < b2 < c1 — 사람이 검수한 묶음 파일이 자동 생성보다 앞선다.
// 쓰는 중인 파일(깨진 JSON)은 경고만 하고 건너뜀.
const CONTENT_RE = [/^content_(b1|b2|c1)_\d+\.json$/, /^content_auto_\d{4}-\d{2}-\d{2}\.json$/];
const contentFiles = fs.readdirSync(DATA).filter((f) => CONTENT_RE.some((re) => re.test(f))).sort();
const contentBroken = [];
for (const f of contentFiles) {
  try { for (const c of readJson(path.join(DATA, f))) if (c?.key) content.set(c.key, c); }
  catch (e) { console.warn(`내용 파일 건너뜀 ${f}: ${e.message}`); contentBroken.push(f); }
}

const tatoebaPath = path.join(DATA, 'tatoeba_de_ko.json');
const tatoeba = fs.existsSync(tatoebaPath) ? readJson(tatoebaPath) : [];
// 문장마다 낱말 집합을 한 번만 만들어 둔다. 명사는 표기 그대로, 그 밖은 문장 첫 낱말만 소문자로 바꿔 비교
// (「Zum Wohl!」의 명사 Wohl 이 형용사 wohl 에 걸리지 않도록).
const tokRe = /[A-Za-zÄÖÜäöüß]+/g;
const tatoebaTok = tatoeba.map((p) => {
  const t = p.de.match(tokRe) || [];
  return { ...p, exact: new Set(t), loose: new Set(t.map((x, i) => (i === 0 ? lower(x) : x))) };
});
function findTatoeba(lemma, pos) {
  if (lemma.includes(' ')) return null; // ponytail: 여러 낱말 표제어는 건너뜀(B1 6건)
  return tatoebaTok.find((p) => (pos === 'noun' ? p.exact : p.loose).has(lemma)) || null;
}

const sortWords = (a, b) =>
  (a.freq_rank ?? Infinity) - (b.freq_rank ?? Infinity) || collator.compare(a.lemma, b.lemma);
const dups = [];
const seen = new Set();
const words = [];
const humanOut = []; // 내용 파일에서 keep:false 로 뺀 단어 {level, key, lemma, pos, reason}
for (const w of [...b1, ...b2, ...c1]) {
  const c = content.get(`${w.lemma}|${w.pos}`);
  if (c?.keep === false) { humanOut.push({ level: w.level, key: c.key, lemma: w.lemma, pos: w.pos, reason: c.reason || '(사유 없음)' }); continue; }
  w.keep = c ? true : null; // null = 아직 판정 전(내용 파일 없음) → 정기 업데이트가 claude 로 판정·채움
  const k = lookup(w.lemma, w.pos);
  w.gender = w.pos === 'noun' ? (w.gender || k?.gender || null) : null;
  w.plural = k?.plural || null;
  w.ipa = k?.ipa || null;
  w.gloss_en = k?.gloss_en || null;
  w.freq_rank = w.freq_rank ?? freqRank.get(key(w.lemma, w.pos)) ?? null;
  w.gloss_ko = c?.gloss_ko || null;
  w.gloss_status = w.gloss_ko ? 'generated' : 'missing';
  w.example_de = c?.example_de || null;
  w.example_ko = c?.example_ko || null;
  w.example_src = w.example_de ? 'gen' : null;
  w.scene_en = c?.scene_en || null;
  // Tatoeba 덮어쓰기는 기본 끔(2026-10-13): 속담·감탄사(「O mein Gott!」)가 많아 단어 뜻·그림과 이어지지 않음. 켜려면 TATOEBA=1
  const t = process.env.TATOEBA === '1' && !w.example_de ? findTatoeba(w.lemma, w.pos) : null;
  if (t) { w.example_de = t.de; w.example_ko = t.ko; w.example_src = `tatoeba:${t.de_id}`; }
  const u = `${w.lemma}|${w.pos}`;
  if (seen.has(u)) { dups.push(u); continue; }
  seen.add(u);
  words.push(w);
}
const b1Words = words.filter((w) => w.level === 'B1').sort(sortWords);
const b2Words = words.filter((w) => w.level === 'B2').sort(sortWords);
const c1Words = words.filter((w) => w.level === 'C1').sort(sortWords);
// B1 → B2 → C1 순서. C1 을 뒤에 붙이므로 B1·B2 의 id·seq(w0001~)는 C1 이 생겨도 그대로다.
const all = [...b1Words, ...b2Words, ...c1Words];
all.forEach((w, i) => { w.seq = i + 1; w.id = 'w' + String(i + 1).padStart(4, '0'); });

// C1 내용 작업용 묶음 8개: node scripts/seed/build.mjs --chunks 일 때만 쓴다(정기 빌드가 작업 중인 묶음을 흔들지 않도록).
// ponytail: 사람 판정(keep:false)으로 빠진 C1 은 묶음에도 없다 — 내용 파일이 생기기 전에 한 번 쓰는 용도.
if (process.argv.includes('--chunks')) {
  const size = Math.ceil(c1Words.length / 8);
  for (let i = 0; i < 8; i++) {
    const part = c1Words.slice(i * size, (i + 1) * size).map((w) => ({ key: `${w.lemma}|${w.pos}`, lemma: w.lemma, pos: w.pos, gender: w.gender }));
    fs.writeFileSync(path.join(DATA, `chunk_c1_${i + 1}.json`), JSON.stringify(part));
  }
  console.log(`chunk_c1_1..8.json: ${c1Words.length}건, 묶음당 ${size}건`);
}

// 리드가 같은 규칙으로 따로 만든 b2_dwds_keep.json 과 DWDS 선별 결과(사람 판정 제외 전)를 표기 그대로 비교
const keepPath = path.join(DATA, 'b2_dwds_keep.json');
const keepRef = fs.existsSync(keepPath) ? new Set(readJson(keepPath).map((x) => `${x.lemma}|${x.pos}`)) : null;
const mine = new Set(b2.map((w) => `${w.lemma}|${w.pos}`));
const onlyMine = keepRef ? [...mine].filter((x) => !keepRef.has(x)) : [];
const onlyRef = keepRef ? [...keepRef].filter((x) => !mine.has(x)) : [];

// ── 6. seed.sql ───────────────────────────────────────────────────────────────
const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const COLS = ['id', 'lemma', 'pos', 'gender', 'plural', 'ipa', 'level', 'level_src', 'gloss_en', 'gloss_ko',
  'gloss_status', 'example_de', 'example_ko', 'example_src', 'scene_en', 'image_id', 'image_status', 'freq_rank', 'seq'];
const sql = [`-- Wortling 씨앗 · ${new Date().toISOString()} · words ${all.length}건 (B1 ${b1Words.length} / B2 ${b2Words.length} / C1 ${c1Words.length})`];
for (let i = 0; i < all.length; i += BATCH) {
  const rows = all.slice(i, i + BATCH).map((w) =>
    `(${COLS.map((c) => q(c === 'image_status' ? 'none' : c === 'image_id' ? null : w[c])).join(',')})`);
  sql.push(`INSERT INTO words (${COLS.join(',')}) VALUES\n${rows.join(',\n')};`);
}
for (let i = 0; i < all.length; i += BATCH) {
  const rows = all.slice(i, i + BATCH).map((w) => `('${w.id}',0,'${DUE}')`);
  sql.push(`INSERT INTO cards (word_id,state,due) VALUES\n${rows.join(',\n')};`);
}
// 자체 점검: 고유성·id 형식·문장 크기(wrangler 한도 100KB)
assert.strictEqual(new Set(all.map((w) => `${w.lemma}|${w.pos}`)).size, all.length, 'lemma|pos 중복');
assert.ok(all.every((w, i) => w.id === 'w' + String(i + 1).padStart(4, '0') && w.seq === i + 1), 'id/seq 어긋남');
assert.ok(all.every((w) => ['B1', 'B2', 'C1'].includes(w.level) && (w.pos !== 'noun' || !w.gender || /^(der|die|das)$/.test(w.gender))), 'level/gender 값');
assert.ok(sql.every((s) => Buffer.byteLength(s) < 100_000), 'INSERT 문이 100KB 를 넘음');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'seed.sql'), sql.join('\n') + '\n');
// words.json: 정기 업데이트(scripts/words/update.mjs)가 읽는다. 모든 단어의 전체 칸 + keep(true·null=판정 전),
// 그리고 keep:false 로 빠진 단어(id 없음)도 넣어 다시 채우지 않게 한다. id·seq 는 이 빌드 안의 자리 번호다(DB id 와 다를 수 있음).
const WCOLS = COLS.filter((c) => c !== 'image_id' && c !== 'image_status');
fs.writeFileSync(path.join(OUT_DIR, 'words.json'), JSON.stringify([
  ...all.map((w) => ({ ...Object.fromEntries(WCOLS.map((c) => [c, w[c] ?? null])), keep: w.keep })),
  ...humanOut.map((h) => ({ lemma: h.lemma, pos: h.pos, level: h.level, keep: false, reason: h.reason })),
]));

// ── 7. report.md ──────────────────────────────────────────────────────────────
const pct = (n, d) => (d ? `${n} (${Math.round((n / d) * 100)}%)` : '0');
const count = (arr, f) => arr.filter(f).length;
function fillRows(list) {
  const nouns = list.filter((w) => w.pos === 'noun');
  return [
    ['명사 성(gender)', pct(count(nouns, (w) => w.gender), nouns.length)],
    ['명사 복수(plural)', pct(count(nouns, (w) => w.plural), nouns.length)],
    ['발음(ipa)', pct(count(list, (w) => w.ipa), list.length)],
    ['영어 뜻(gloss_en)', pct(count(list, (w) => w.gloss_en), list.length)],
    ['한국어 뜻(gloss_ko)', pct(count(list, (w) => w.gloss_ko), list.length)],
    ['예문(example_de)', pct(count(list, (w) => w.example_de), list.length)],
    ['예문 출처 tatoeba', pct(count(list, (w) => w.example_src?.startsWith('tatoeba')), list.length)],
    ['그림 장면(scene_en)', pct(count(list, (w) => w.scene_en), list.length)],
    ['빈도 순위(freq_rank)', pct(count(list, (w) => w.freq_rank != null), list.length)],
  ];
}
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const posList = ['noun', 'verb', 'adj', 'adv', 'prep', 'conj', 'pron', 'other', 'phrase'];
const byPos = (list) => posList.map((p) => count(list, (w) => w.pos === p));
const sample = (list) => table(['id', 'lemma', 'pos', 'gender', 'plural', 'ipa', 'gloss_en', 'gloss_ko', 'example_src', 'freq_rank'],
  list.slice(0, 10).map((w) => [w.id, w.lemma, w.pos, w.gender ?? '', w.plural ?? '', w.ipa ?? '', w.gloss_en ?? '', w.gloss_ko ?? '', w.example_src ?? '', w.freq_rank ?? ''].map((v) => String(v).replace(/\|/g, '\\|'))));
const contentRead = contentFiles.filter((f) => !contentBroken.includes(f));
const nFiles = (pre) => contentRead.filter((f) => f.startsWith(`content_${pre}_`)).length;
const LEVELS = [['B1', b1Words], ['B2', b2Words], ['C1', c1Words]];
const DWDS_WHY = ['DWDS 없음', '품사 불일치', '드문 단어', '중복'];
const humanBy = Object.entries(Object.groupBy(humanOut, (h) => h.reason)).sort((a, b) => b[1].length - a[1].length);
// 수준 하나의 선별 과정(WordHoard 후보 → 기존 규칙 → DWDS → 사람 판정)
function selectionSection(level, picked, kept) {
  const dr = dropped[level];
  const rt = retagged[level];
  const dwdsDropN = DWDS_WHY.reduce((n, why) => n + (dr[why]?.length || 0), 0);
  return `## ${level} 후보 선별
WordHoard cefr_estimate=${level} 이면서 NOUN/VERB/ADJ/ADV ${rawBy[level].length}건
→ 기존 규칙(B1 중복·글자·kaikki·비속어) 통과 ${picked.length + dwdsDropN}건
→ DWDS 대조 뒤 ${picked.length}건
→ 사람 판정 제외 뒤 ${kept.length}건

${table(['탈락 사유', '건수', '예(앞 15개)'], Object.entries(dr).sort((a, b) => b[1].length - a[1].length)
  .map(([why, list]) => [why, list.length, list.slice(0, 15).join(', ')]))}

품사 고침 ${rt.length}건(그중 고친 뒤 빈도·중복으로 빠진 것 ${rt.filter((r) => r.lost).length}건): ${rt.map((r) => `${r.lemma} ${r.from}→${r.to}${r.lost ? `(빠짐: ${r.lost})` : ''}`).join(', ')}`;
}
const report = `# Wortling 씨앗 보고 (${new Date().toISOString().slice(0, 10)})

> **빈 DB 에만 넣는다.** id(w0001…)는 정렬 순서대로 매기는 자리 번호다. 단어가 하나만 늘거나 빠져도 그 뒤 id 가 전부 밀린다.
> 이미 씨앗이 든 DB 에 새 seed.sql 을 넣으면 다른 단어가 같은 id 를 받아, 쌓인 학습 기록(cards)이 엉뚱한 단어에 붙는다.
> 다시 넣을 때는 D1 을 새로 만들고 이주(migrations) → seed.sql 순서로 넣는다.
> 이미 쓰는 DB 에 새 단어를 더할 때는 seed.sql 이 아니라 \`npm run words:update\`(scripts/words/update.mjs)를 쓴다. (lemma,pos)로 비교해 없는 것만 서버가 id 를 이어 매겨 넣는다.

빌드 명령: \`npm run seed:build\` → seed/seed.sql (words ${all.length}건, cards ${all.length}건, INSERT ${sql.length - 1}문) + seed/words.json(정기 업데이트용, keep:false 포함 ${all.length + humanOut.length}건)
순서: B1 → B2 → C1, 수준 안에서는 빈도 순위 오름차순(없으면 맨 뒤) → 표제어. C1 을 뒤에 붙이므로 B1·B2 의 id 는 C1 과 상관없이 그대로다.
빌드 때 읽은 한국어 내용 파일: B1 ${nFiles('b1')}개 · B2 ${nFiles('b2')}개 · C1 ${nFiles('c1')}개 · 자동 ${nFiles('auto')}개 — ${contentRead.length ? contentRead.join(', ') : '없음'}${contentBroken.length ? ` (깨져서 건너뜀: ${contentBroken.join(', ')})` : ''}
gloss_ko 채워진 단어: ${LEVELS.map(([lv, l]) => `${lv} ${count(l, (w) => w.gloss_ko)}건`).join(' · ')}
내용 파일은 content_<b1|b2|c1>_<번호>.json 과 content_auto_<날짜>.json 이름만 읽는다(쓰는 중인 조각 파일은 무시). 같은 단어는 auto < b1 < b2 < c1 순으로 뒤 파일이 이긴다.

## 수준·품사별 수
${table(['level', '합계', ...posList], LEVELS.map(([lv, l]) => [lv, l.length, ...byPos(l)]))}

## 채움 비율
${table(['항목', ...LEVELS.map(([lv]) => lv)], fillRows(b1Words).map((r, i) => [r[0], ...LEVELS.map(([, l]) => fillRows(l)[i][1])]))}

## DWDS 대조 규칙 (B2·C1 공통)
파일: DWDS 표제어 목록(.data/dwds_lemma.csv, 환경변수 DWDS_LEMMA_CSV 로 바꿈). 순서대로 적용한다.
1. DWDS 에 명사·동사·형용사·부사 항목이 없으면 뺀다(「DWDS 없음」, 접속사·서수·고유명사로만 있는 표제어 포함).
2. 품사가 DWDS 품사에 없으면, DWDS 품사가 하나뿐일 때만 그 품사로 고친다(「품사 고침」). 성·복수·발음·영어 뜻은 새 품사로 kaikki 를 다시 찾는다. 여럿이면 뺀다(「품사 불일치」).
3. DWDS 빈도 등급이 그 (표제어,품사)의 모든 항목에서 0 또는 1 이면 뺀다(「드문 단어」).
4. (표제어,품사)가 B1 이나 앞서 고른 단어(B2 는 앞선 B2, C1 은 B2 전체와 앞선 C1, 사람 판정 전 기준)와 같으면 뺀다(「중복」).

${selectionSection('B2', b2, b2Words)}

리드 대조(b2_dwds_keep.json, 같은 규칙으로 따로 만든 목록 ${keepRef ? keepRef.size : '없음'}건): ${!keepRef ? '파일 없음' : !onlyMine.length && !onlyRef.length ? '차이 없음' : `이 빌드에만 ${onlyMine.length}건(${onlyMine.join(', ')}) · 목록에만 ${onlyRef.length}건(${onlyRef.join(', ')})`}

${selectionSection('C1', c1, c1Words)}

## 사람 판정 제외 (내용 파일 keep:false)
${humanOut.length}건(${LEVELS.map(([lv]) => `${lv} ${count(humanOut, (h) => h.level === lv)}`).join(' · ')}). words·cards 에 넣지 않는다(words.json 에는 keep:false 로 남겨 다시 채우지 않음).
${humanOut.length ? table(['사유', '건수', '예(앞 10개)'], humanBy.slice(0, 15).map(([why, list]) => [why.replaceAll('|', '/'), list.length, list.slice(0, 10).map((h) => h.key.replace('|', '/')).join(', ')]))
  + (humanBy.length > 15 ? `\n그 밖의 사유 ${humanBy.length - 15}가지 ${humanBy.slice(15).reduce((n, [, l]) => n + l.length, 0)}건` : '')
  + `\n\n제외 단어 전체(${humanOut.length}): ${humanOut.map((h) => h.key.replace('|', '/')).join(', ')}` : '없음'}

## kaikki 에 없어 보강 못 한 B1 (noun/verb/adj/adv 만)
${(() => { const l = b1Words.filter((w) => w.pos in { noun: 1, verb: 1, adj: 1, adv: 1 } && !lookup(w.lemma, w.pos)); return `${l.length}건: ${l.map((w) => w.lemma).join(', ')}`; })()}

## B1 안 중복(lemma,pos) — 첫 항목만 남김
${dups.length ? dups.map((d) => `- ${d}`).join('\n') : '없음'}

## Tatoeba 예문
기본 끔(TATOEBA=1 일 때만 빈 예문 자리에 씀). 적용: ${LEVELS.map(([lv, l]) => `${lv} ${count(l, (w) => w.example_src?.startsWith('tatoeba'))}건`).join(' · ')}

${LEVELS.map(([lv, l]) => `## 표본 ${lv} (앞 10건)\n${sample(l)}`).join('\n\n')}

## 자료 출처·라이선스
- Goethe-Zertifikat B1 단어 목록(DWDS 제공): 표제어·품사·성 목록으로만 사용.
- DWDS 표제어 목록: B2·C1 표제어·품사·빈도 등급 대조에만 사용.
- kaikki.org (Wiktextract, English Wiktionary 추출): 성·복수·IPA·영어 뜻. CC BY-SA 4.0 — "Wiktionary contributors, via kaikki.org (Tatu Ylonen, Wiktextract)".
- WordHoard German (wordhoard-de.csv): 빈도 순위·B2·C1 후보. CC BY-SA 4.0 — "WordHoard German frequency list".
- Tatoeba (tatoeba.org): 독·한 예문 쌍. CC BY 2.0 FR — 쓸 때는 example_src 에 tatoeba:<id> 로 출처 표기.
`;
const g1 = path.join(OUT_DIR, 'g1.md'); // node scripts/seed/verify.mjs 가 남긴 게이트 결과가 있으면 뒤에 붙인다
fs.writeFileSync(path.join(OUT_DIR, 'report.md'), report + (fs.existsSync(g1) ? '\n' + fs.readFileSync(g1, 'utf8') : ''));
console.log(`words ${all.length} (B1 ${b1Words.length}, B2 ${b2Words.length}, C1 ${c1Words.length}) → seed/seed.sql, seed/words.json, seed/report.md`);
for (const lv of ['B2', 'C1']) console.log(`${lv} 탈락:`, Object.fromEntries(Object.entries(dropped[lv]).map(([k, v]) => [k, v.length])), '품사 고침:', retagged[lv].length);
console.log(`b2_dwds_keep.json 대조: 나만 ${onlyMine.length} [${onlyMine.slice(0, 20)}] · 목록만 ${onlyRef.length} [${onlyRef.slice(0, 20)}]`);
console.log(`사람 판정 제외 ${humanOut.length}건 · 내용 파일 읽음 ${contentRead.length}개 · 깨짐 ${contentBroken.length}개 · B1 안 중복 ${dups.length}`);
