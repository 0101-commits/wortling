// 「검사 대기」 그림(Worker worker/pending.ts) 처리. daily.mjs 가 부른다 — 시험하려고 AI·Worker 를 인자로 받는다.
// 그림 검사 AI 가 막히면(판정 null) 그린 그림을 버리지 않고 대기로 올려 두고, 다음 실행이 먼저 검사한다.

/** 판정 결과 v(Map | null)로 그림 목록을 가른다 → {pass, reject, hold, down}
 *  hold = 검사를 못 받은 그림(AI 실패 = 전부 · 판정에서 빠진 것). down = AI 자체가 막혔나(v === null) */
export function sortByVerdict(list, v) {
  if (!v) return { pass: [], reject: [], hold: [...list], down: true };
  const out = { pass: [], reject: [], hold: [], down: false };
  for (const d of list) {
    const x = v.get(d.id ?? d.w?.id);
    if (!x) out.hold.push(d);
    else if (x.ok === false) out.reject.push(d);
    else out.pass.push(d);
  }
  return out;
}

/** 대기 그림을 먼저 검사한다. 통과 → 올리고 대기 삭제 · 탈락 → 대기 삭제 + 고친 장면(fix)으로 다시 그릴 단어(front) · 판정 못 받은 것은 대기에 남김.
 *  api(path, opts) = daily.mjs 의 Worker 관리 API 호출. judge(items) = judgeImages. wantsNew(id) = 다시 그리기(restyle·--redo) 대상인가
 *  — 그런 단어는 이미 image_status='ok' 여도 대기분이 새 그림이라 지우지 않고 검사한다.
 *  dry 면 읽기만(목록·판정 없이 개수만). 반환 left = 아직 대기에 남은 id 집합, judgeDown = 검사 AI 못 씀, unavailable = 대기 길 자체가 안 열림 */
/** 판정에서 계속 빠지는 대기 그림을 지우기까지 날 수 */
export const HOLD_DAYS = 7;

export async function processPending({ api, judge, batch = 10, wantsNew = () => false, saveRejected = async () => {}, dry = false, say = console.log, now = Date.now }) {
  const out = { total: 0, left: new Set(), uploaded: [], rejected: [], dropped: [], gaveUp: [], fix: new Map(), front: [], judgeDown: false, unavailable: false };
  let items;
  try {
    items = (await api('/api/admin/pending')).items;
  } catch (e) {
    // Worker 가 아직 새 판이 아니면 404 — 예전처럼(검사 못 하면 올리지 않음) 돌게 둔다
    out.unavailable = true;
    say(`검사 대기 목록을 못 읽음 — 건너뜀: ${String(e.message || e).slice(0, 150)}`);
    return out;
  }
  out.total = items.length;
  for (const it of items) out.left.add(it.id);
  if (!items.length) return out;
  say(`검사 대기 ${items.length}장 — 먼저 검사`);
  if (dry) return out;

  const forget = async (id) => {
    await api(`/api/admin/pending/${id}`, { method: 'DELETE' });
    out.left.delete(id);
  };
  // 단어 정보 + 이미 올라간 단어(그사이 다른 길로 ok 가 됨)는 대기분을 지운다
  const cand = [];
  for (const it of items) {
    try {
      const w = (await api(`/api/word/${it.id}`)).word;
      if (w.image && !wantsNew(it.id)) {
        await forget(it.id);
        out.dropped.push(it.id);
        continue;
      }
      cand.push({ id: it.id, at: it.at, word: `${w.gender ? w.gender + ' ' : ''}${w.lemma}`, meaning_ko: w.gloss_ko });
    } catch (e) {
      if (/→ 404/.test(String(e.message))) {
        await forget(it.id).catch(() => {}); // 카드 행이 없는 단어 — 대기분도 쓸모없다
        out.dropped.push(it.id);
      } else say(`대기 ${it.id} 단어 확인 실패 — 다음에: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  for (let i = 0; i < cand.length && !out.judgeDown; i += batch) {
    const group = [];
    for (const c of cand.slice(i, i + batch)) {
      try {
        group.push({ ...c, png: await api(`/api/admin/pending/${c.id}`, { bin: true }) });
      } catch (e) {
        say(`대기 ${c.id} 받기 실패 — 다음에: ${String(e.message || e).slice(0, 120)}`);
      }
    }
    if (!group.length) continue;
    const v = await judge(group);
    const s = sortByVerdict(group, v);
    if (s.down) {
      out.judgeDown = true;
      say('검사 대기 판정 멈춤 — 그림 검사 AI 를 못 씀(대기는 그대로, 오늘 그린 그림도 판정 없이 대기로)');
      break;
    }
    for (const d of s.pass) {
      try {
        await api(`/api/admin/image/${d.id}`, { method: 'PUT', raw: d.png, headers: { 'content-type': 'image/webp' } });
        await forget(d.id);
        out.uploaded.push(d.id);
        say(`대기 그림 ${d.id} ${d.word} 통과 → 올림`);
      } catch (e) {
        say(`대기 그림 ${d.id} 올리기 실패 — 다음에: ${String(e.message || e).slice(0, 120)}`);
      }
    }
    for (const d of s.reject) {
      const x = v.get(d.id);
      say(`대기 그림 ${d.id} ${d.word} 뜻 탈락(${x.why})${x.scene ? ' → 고친 장면으로 다시 그림' : ''}`);
      await saveRejected(d.id, 'pending-meaning', x.why, d.png);
      await forget(d.id);
      out.rejected.push(d.id);
      if (x.scene) {
        out.fix.set(d.id, x.scene);
        out.front.push(d.id);
      } else {
        out.gaveUp.push(d.id); // 고친 장면이 없으면 기존 규칙대로 실패 표시(daily.mjs 가 처리)
      }
    }
    // s.hold(판정에서 빠진 그림)는 대기에 그대로 — 다음 실행이 다시. 단 HOLD_DAYS 넘게 계속 빠지면 지운다
    // (같은 그림이 매일 Flash 몫을 쓰고 대기 상한 칸을 영구히 차지하지 않게 — 단어는 나중에 새로 그려진다)
    for (const d of s.hold) {
      if (d.at && now() - Date.parse(d.at) > HOLD_DAYS * 86_400_000) {
        await forget(d.id);
        out.dropped.push(d.id);
        say(`대기 그림 ${d.id} ${d.word} ${HOLD_DAYS}일 넘게 판정에서 빠짐 → 지움(나중에 새로 그림)`);
      }
    }
  }
  return out;
}
