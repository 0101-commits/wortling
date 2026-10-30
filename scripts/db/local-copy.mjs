// 가장 최근 백업(backup/*.sql · *.sql.gz)을 로컬 SQLite 파일 하나로 풀어 둔다(node:sqlite).
// 분석·검수 스크립트가 원격 D1 대신 이 사본을 읽게 하려는 것 — D1 무료 읽기 한도(하루 500만 행)는 계정 전체가 나눠 쓴다.
// 백업보다 사본이 새것이면 다시 만들지 않는다. 쓰는 법: import { openLocalDb } from './local-copy.mjs'
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BACKUP_DIR = join(ROOT, 'backup');
export const COPY_PATH = join(ROOT, '.wrangler', 'local-copy', 'wortling.sqlite');

/** 수정 시각이 가장 늦은 전체 백업 파일 경로(없으면 null). 이름이 wortling_*.sql · YYYY-MM-DD.sql(.gz) 인 것만 — 같은 곳의 일부 SQL(level_delete 등)은 제외 */
export function newestBackup(dir = BACKUP_DIR) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^(wortling_.+|\d{4}-\d{2}-\d{2})\.sql(\.gz)?$/.test(f))
    .map((f) => ({ path: join(dir, f), at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  return files[0]?.path ?? null;
}

/** 백업 → SQLite 파일. 만드는 도중 실패해도 옛 사본이 깨지지 않게 임시 파일에 쓰고 바꿔 끼운다 */
export function buildCopy(backup, out = COPY_PATH) {
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  rmSync(tmp, { force: true });
  const raw = readFileSync(backup);
  const sql = (backup.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
  const db = new DatabaseSync(tmp);
  try {
    db.exec('PRAGMA foreign_keys = OFF'); // D1 내보내기는 defer_foreign_keys 로 적재 순서를 건너뛴다
    db.exec('PRAGMA synchronous = OFF'); // 한 번에 몰아 넣는 임시 파일이라 줄마다 디스크에 쓰지 않는다
    db.exec('BEGIN');
    db.exec(sql);
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  rmSync(out, { force: true });
  renameSync(tmp, out);
  return out;
}

/** 사본 DatabaseSync 를 연다(읽기 전용 쓰임). 백업이 더 새것이면 먼저 다시 만든다. { backup, out } 로 경로를 바꿀 수 있다 */
export function openLocalDb({ backup = newestBackup(), out = COPY_PATH } = {}) {
  if (!backup) throw new Error('백업이 없다: backup/*.sql 또는 *.sql.gz 가 필요하다(원격을 읽지 않는다)');
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(backup).mtimeMs) buildCopy(backup, out);
  return new DatabaseSync(out);
}
