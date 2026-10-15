// 카드 검토·뉴스 단어 DB 함수 시험: 0004 마이그레이션 + D1 흉내(tests/d1.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1, addWord } from './d1.mjs';
import { buildToday, loadSettings } from '../worker/deck.ts';

test('0004: words 새 칸 4 · 새 표 5', () => {
  const db = fakeD1();
  const cols = db.raw.prepare("SELECT name FROM pragma_table_info('words')").all().map((r) => r.name);
  for (const c of ['checked_at', 'news_rank', 'news_hits30', 'pinned']) assert.ok(cols.includes(c), c);
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['word_changes', 'word_reports', 'word_requests', 'news_days', 'word_skips']) assert.ok(tables.includes(t), t);
});

test('pinned: 레벨 설정(B1) 밖의 C1 단어도 새 카드 맨 앞', async () => {
  const db = fakeD1();
  addWord(db, { id: 'w0001', lemma: 'Haus', seq: 1 });
  addWord(db, { id: 'w0002', lemma: 'Ermittlung', level: 'C1', seq: 2, pinned: 1 });
  addWord(db, { id: 'w0003', lemma: 'Kuchen', level: 'C1', seq: 3 });
  const s = await loadSettings(db);
  assert.equal(s.level, 'B1');
  const t = await buildToday(db, s, new Date('2026-10-15T00:00:00Z'));
  assert.deepEqual(t.fresh.map((x) => x.word.id), ['w0002', 'w0001']);
});
