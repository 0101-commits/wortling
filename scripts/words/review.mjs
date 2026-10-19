// 매일 단어 작업 2/2(words.yml, news.mjs 다음): 카드 검토 — 고르기(서버) → 기계 근거(색인) → AI 25개씩 → decide → 고치기·기록.
// 설계 docs/superpowers/specs/2026-10-15-word-review-news-design.md 「2. 검토 규칙」
// 옵션: --dry(서버에 안 씀, 앞 10건 판정을 보여 줌) · --max=N(하루 검토 수, 기본 250)
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { askJson } from '../ai.mjs';
import { ROOT, api, kstDay, notify, requireEnv } from '../admin.mjs';
import { acceptVerdicts, adminItem, decide, factsFor, reviewPrompt, summaryText } from './lib.mjs';

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
      verdicts = acceptVerdicts(await askJson(reviewPrompt(batch, (w) => facts.get(w.id))), batch.map((w) => w.id));
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
      items.push(adminItem(w, d));
    }
    // 서버 쓰기 실패도 그 묶음만 — 바깥에서 잡았더니 남은 묶음을 다 건너뛰었다(최종 검토 반영)
    if (!DRY && items.length) {
      try {
        await api('/api/admin/words', { method: 'POST', body: { items } });
      } catch (e) {
        log.failedBatches++;
        log.errors.push(`묶음 ${i / BATCH + 1} 저장: ${String(e.message || e).slice(0, 150)}`);
      }
    }
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
