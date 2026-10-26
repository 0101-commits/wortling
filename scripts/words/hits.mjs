// 매일 단어 작업 3/3(words.yml, review.mjs 다음): 예문 속 표제어 낱말 적기(기획 v8 W1).
// 찾기 규칙(shared/cloze.ts findWord)으로 못 찾는 예문 — 불규칙 과거분사(gerettet) · 분리동사(gebe … auf) · 모음 바뀜(wirf) — 만
// AI(Flash-Lite)에 묻고, 답한 낱말이 예문에 정말 있을 때만 words.example_hit 에 적는다. 더 공부하기 빈칸 · 짚기와 아침 알림 빈칸이 쓴다.
// 옵션: --dry(서버에 안 씀, 앞 10건을 보여 줌) · --max=N(하루 물을 카드 수, 기본 400 — 처음 한 번 ≈850장이 밀려 있어 사흘쯤)
import { askJson } from '../ai.mjs';
import { api, kstDay, notify, requireEnv } from '../admin.mjs';
import { acceptHits, hitMisses, hitsPrompt } from './lib.mjs';

const DRY = process.argv.includes('--dry');
const MAX = Number((process.argv.find((a) => a.startsWith('--max=')) || '').slice(6)) || 400;
const BATCH = 40;

const log = { day: kstDay(), dry: DRY, waiting: 0, misses: 0, asked: 0, found: 0, none: 0, failedBatches: 0, errors: [] };
const sample = [];

try {
  requireEnv();
  const items = (await api('/api/admin/examples')).items;
  log.waiting = items.length;
  const misses = hitMisses(items);
  log.misses = misses.length;
  let fails = 0;
  for (const batch of chunks(misses.slice(0, MAX), BATCH)) {
    let got;
    try {
      got = acceptHits(await askJson(hitsPrompt(batch)), batch);
      fails = 0;
    } catch (e) {
      log.failedBatches++;
      log.errors.push(String(e.message || e).slice(0, 150));
      // 하루 몫 소진(429 PerDay)이나 연속 실패면 남은 묶음은 내일
      if (++fails >= 3 || /PerDay|quota/i.test(String(e.message))) break;
      continue;
    }
    log.asked += batch.length;
    for (const v of got.values()) v === '-' ? log.none++ : log.found++;
    if (DRY) {
      for (const w of batch) if (got.has(w.id) && sample.length < 10) sample.push(`${w.lemma}: ${got.get(w.id)} ← ${w.example_de}`);
      continue;
    }
    if (got.size) {
      try {
        await api('/api/admin/words', { method: 'POST', body: { items: [...got].map(([id, hit]) => ({ id, example_hit: hit })) } });
      } catch (e) {
        log.failedBatches++;
        log.errors.push(`저장: ${String(e.message || e).slice(0, 150)}`);
      }
    }
  }
} catch (e) {
  log.errors.push(String(e.message || e).slice(0, 300));
}
console.log(JSON.stringify(log));
if (DRY) for (const x of sample) console.log(`· ${x}`);
if (log.errors.length) {
  if (!DRY) await notify('error', 'Wortling 예문 낱말 작업 오류', log.errors.slice(0, 5).join('\n'));
  process.exitCode = 1;
}

function* chunks(list, n) {
  for (let i = 0; i < list.length; i += n) yield list.slice(i, i + n);
}
