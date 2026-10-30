#!/usr/bin/env bash
# kaggle-draw.yml 이 .data/ledger.json · kaggle-queue.json 을 main 에 되올린다(daily.yml 「그림 상태 되올리기」와 같은 방식).
# main 을 받아 그 위에 두 파일만 커밋 — push 가 밀리면 세 번까지.
set -u
export MSYS_NO_PATHCONV=1
git config user.name 'github-actions[bot]'
git config user.email '41898283+github-actions[bot]@users.noreply.github.com'
for i in 1 2 3; do
  git fetch -q origin main
  main=$(git rev-parse origin/main)
  git reset -q "$main"
  for f in .data/ledger.json .data/kaggle-queue.json; do
    if [ -f "$f" ]; then git add -f "$f"; else git rm -q --cached --ignore-unmatch "$f"; fi
  done
  git diff --cached --quiet && exit 0
  git commit -q -m "chore(kaggle): ${1:-장부 갱신}"
  git push -q origin HEAD:main && exit 0
  echo "push 밀림 — 다시($i)"
done
exit 1
