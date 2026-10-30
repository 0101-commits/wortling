#!/usr/bin/env bash
# kaggle-draw.yml 이 .data/ledger.json · kaggle-queue.json · restyle.json 의 변경을 main 에 되올린다.
# daily.yml 과 같은 main 을 쓰므로(동시에 돌 수 있음) 파일을 덮어쓰지 않고 「변경 목록」(.data/kaggle-ops.json)을 매번 최신 main 의 파일에 다시 적용해 커밋한다.
# push 가 밀리면(다른 쪽이 먼저 올림) 최신 main 을 받아 처음부터 다시 — 최대 5번.
set -u
export MSYS_NO_PATHCONV=1
git config user.name 'github-actions[bot]'
git config user.email '41898283+github-actions[bot]@users.noreply.github.com'
[ -f .data/kaggle-ops.json ] || { echo '변경 목록 없음 — 할 일 없음'; exit 0; }
cp .data/kaggle-ops.json "${RUNNER_TEMP:-/tmp}/kaggle-ops.json"
for i in 1 2 3 4 5; do
  git fetch -q origin main || { sleep 5; continue; }
  main=$(git rev-parse origin/main)
  git reset -q "$main"
  cp "${RUNNER_TEMP:-/tmp}/kaggle-ops.json" .data/kaggle-ops.json
  for f in ledger.json kaggle-queue.json restyle.json; do
    git show "$main:.data/$f" > ".data/$f" 2>/dev/null || rm -f ".data/$f"
  done
  node scripts/kaggle.mjs apply || exit 1
  for f in .data/ledger.json .data/kaggle-queue.json .data/restyle.json; do
    if [ -f "$f" ]; then git add -f "$f"; else git rm -q --cached --ignore-unmatch "$f"; fi
  done
  git diff --cached --quiet && exit 0
  git commit -q -m "chore(kaggle): ${1:-장부 갱신}"
  git push -q origin HEAD:main && exit 0
  echo "push 밀림 — 최신 main 에 다시 적용($i)"
  sleep $((i * 3))
done
exit 1
