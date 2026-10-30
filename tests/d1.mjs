// D1 흉내(node:sqlite): migrations/*.sql 을 차례로 적용한 메모리 DB. 시험 전용.
// D1 과 같은 꼴: prepare().bind().all()/first()/run(), batch([...]) 는 한 거래로.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const MIG = new URL('../migrations/', import.meta.url);
// node:sqlite 는 undefined·boolean 을 못 받는다
const arg = (v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v);
const RETURNS_ROWS = /^\s*(SELECT|WITH|PRAGMA)\b|\bRETURNING\b/i;

class Stmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Stmt(this.db, this.sql, args.map(arg));
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args), success: true, meta: { changes: 0 } };
  }
  async first(col) {
    const r = this.db.prepare(this.sql).get(...this.args);
    if (r === undefined) return null;
    return col ? r[col] : r;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  exec() {
    return RETURNS_ROWS.test(this.sql) ? this.all() : this.run();
  }
}

export function fakeD1() {
  const raw = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(f, MIG), 'utf8'));
  return {
    raw,
    prepare: (sql) => new Stmt(raw, sql),
    async batch(stmts) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.exec());
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** 단어 + 카드 한 쌍. 안 준 칸은 새 B1 명사(state 0) */
export function addWord(db, w) {
  const r = {
    pos: 'noun', gender: null, plural: null, level: 'B1', level_src: 'goethe', gloss_ko: '뜻', gloss_status: 'generated',
    example_de: null, example_ko: null, seq: 1, pinned: 0, news_rank: null, freq_rank: null, checked_at: null, image_status: 'none',
    state: 0, due: '2026-10-01T00:00:00.000Z', introduced_at: null, ...w,
  };
  db.raw
    .prepare(`INSERT INTO words(id, lemma, pos, gender, plural, level, level_src, gloss_ko, gloss_status, example_de, example_ko,
      seq, pinned, news_rank, freq_rank, checked_at, image_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.id, r.lemma, r.pos, r.gender, r.plural, r.level, r.level_src, r.gloss_ko, r.gloss_status, r.example_de, r.example_ko,
      r.seq, r.pinned, r.news_rank, r.freq_rank, r.checked_at, r.image_status);
  db.raw.prepare('INSERT INTO cards(word_id, state, due, introduced_at) VALUES (?, ?, ?, ?)').run(r.id, r.state, r.due, r.introduced_at);
}

/** 서로 비슷하지 않은 시험용 표제어(앞 다섯 글자가 다 다름 — worker/deck.ts similarWords 에 안 걸리게). i 는 0~675 */
export const lem = (i) => `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}wort`;
