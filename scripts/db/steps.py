# 로컬 SQLite 사본에서 SQL 을 돌려 가상기계 단계 수를 센다(remote-sql.mjs 의 읽기량 어림용).
# 사용: python -I scripts/db/steps.py <사본.sqlite> <sql 파일>  → 한 줄 JSON {"steps": N, "changes": 쓴 행 수}
# node:sqlite 에는 단계 세는 길이 없고 wrangler --local 은 rows_read 를 안 줘서 sqlite3 모듈의 진행 핸들러를 쓴다.
import json
import sqlite3
import sys

STEP = 100  # 핸들러를 100 단계마다 부른다(세는 오차 ±100)
n = 0


def tick():
    global n
    n += STEP
    return 0


db = sqlite3.connect(sys.argv[1])
db.execute("PRAGMA foreign_keys = OFF")
sql = open(sys.argv[2], encoding="utf-8").read()
db.set_progress_handler(tick, STEP)
db.executescript(sql)
db.set_progress_handler(None, 0)
print(json.dumps({"steps": n, "changes": db.total_changes}))
