// 매일 작업(daily.yml)이 .data/restyle.json 을 되올릴 때 3-방향 합치기.
// 실행이 도는 사이 main 에서도 손으로 고치면(2026-10-19 다시 검사 탈락 7장 추가) 한 줄 JSON 이라 rebase 가 늘 충돌해
// 그날 실행 쪽 목록이 사라졌다. 결과 = main 에서 새로 넣은 것(앞, 손으로 넣은 건 먼저 그리려는 것) + 실행 쪽 목록 − main 에서 뺀 것.
// 그냥 합집합은 안 된다 — 실행이 다시 그려 뺀 id 가 main(실행 전 그대로)에서 되살아난다.
// 사용: node scripts/merge-restyle.mjs base.json main.json run.json   (run.json 을 결과로 덮어씀, 없는 파일은 [])
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function mergeRestyle(base, main, run) {
  // 실행 쪽이 안 바꿨으면 main 그대로 — 손으로 순서만 바꾼 것(있던 id 를 맨 앞으로)이 되돌려지지 않게
  if (run.length === base.length && run.every((id, i) => id === base[i])) return main;
  const inBase = new Set(base), inMain = new Set(main);
  const removed = new Set(base.filter((id) => !inMain.has(id)));
  return [...new Set([...main.filter((id) => !inBase.has(id)), ...run.filter((id) => !removed.has(id))])];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = (f) => {
    try {
      return JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      return [];
    }
  };
  const [base, main, run] = process.argv.slice(2);
  const out = mergeRestyle(read(base), read(main), read(run));
  writeFileSync(run, JSON.stringify(out));
  console.log(`restyle 합침 ${out.length}`);
}
