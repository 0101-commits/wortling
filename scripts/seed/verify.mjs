// 게이트 G1: 일회용 로컬 D1 에 이주 + 씨앗을 넣고 수를 센 뒤 seed/g1.md 에 적고 임시 DB 를 지운다.
// 실행: node scripts/seed/verify.mjs   (실행 뒤 npm run seed:build 를 다시 돌리면 report.md 끝에 붙는다)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = '.wrangler/seed-test';
const base = `npx wrangler d1 ${'%s'} wortling --local --persist-to ${TMP}`;
const run = (sub, extra) => execSync(base.replace('%s', sub) + ' ' + extra, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const query = (sql) => JSON.parse(run('execute', `--json --command "${sql}"`))[0].results;

fs.rmSync(path.join(ROOT, TMP), { recursive: true, force: true });
run('migrations apply', '');
run('execute', '--file seed/seed.sql');
const out = [
  `## 게이트 G1 (로컬 D1 적재 검증, ${new Date().toISOString().slice(0, 16)}Z)`,
  '```',
  `SELECT level, count(*) FROM words GROUP BY level → ${JSON.stringify(query('SELECT level, count(*) n FROM words GROUP BY level'))}`,
  `SELECT count(*) FROM cards → ${JSON.stringify(query('SELECT count(*) n FROM cards'))}`,
  `SELECT gloss_status, count(*) FROM words GROUP BY 1 → ${JSON.stringify(query('SELECT gloss_status, count(*) n FROM words GROUP BY 1'))}`,
  `카드 없는 단어 → ${JSON.stringify(query('SELECT count(*) n FROM words w LEFT JOIN cards c ON c.word_id=w.id WHERE c.word_id IS NULL'))}`,
  '표본:',
  // 표본: 첫 줄·넷째 줄·B1 끝·B2 처음·맨 끝 (단어 수가 바뀌어도 경계를 따라간다)
  ...query("SELECT id,level,lemma,pos,gender,plural,ipa,gloss_en,gloss_ko,example_de,example_src,freq_rank FROM words WHERE seq IN (1,4,(SELECT max(seq) FROM words WHERE level='B1'),(SELECT min(seq) FROM words WHERE level='B2'),(SELECT max(seq) FROM words)) ORDER BY seq").map((r) => JSON.stringify(r)),
  `id·seq 어긋남 → ${JSON.stringify(query("SELECT count(*) n FROM words WHERE id <> 'w' || substr('0000' || seq, -4)"))}`,
  '```',
];
fs.writeFileSync(path.join(ROOT, 'seed', 'g1.md'), out.join('\n') + '\n');
fs.rmSync(path.join(ROOT, TMP), { recursive: true, force: true });
console.log(out.join('\n'));
