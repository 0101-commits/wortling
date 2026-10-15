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
