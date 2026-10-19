// claude -p 한 번 불러 JSON 배열을 받는다. 매일 작업(글·장면 쓰기)과 그림 뜻 검사(judge.mjs)가 같이 쓴다.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

function npmGlobalRoot() {
  if (process.env.NPM_GLOBAL_ROOT) return process.env.NPM_GLOBAL_ROOT;
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'npm', 'node_modules');
  return execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
}
const CLAUDE_EXE =
  process.platform === 'win32' ? path.join(npmGlobalRoot(), '@anthropic-ai', 'claude-code', 'bin', 'claude.exe') : 'claude';

// 구독 토큰(CLAUDE_CODE_OAUTH_TOKEN)으로 돌아 사용량이 클로드 코드 한도에서 같이 깎인다 → 부를 때마다·끝날 때 합계를 로그에 남긴다
const total = { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0 };
process.on('exit', () => {
  if (total.calls) console.error(`claude 합계: ${total.calls}번 · 입력 ${total.input} · 캐시쓰기 ${total.cacheWrite} · 캐시읽기 ${total.cacheRead} · 출력 ${total.output} · $${total.usd.toFixed(3)}`);
});
function logUsage(out) {
  const u = out.usage || {};
  const n = { input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0, usd: out.total_cost_usd || 0 };
  total.calls++;
  for (const k of Object.keys(n)) total[k] += n[k];
  console.error(`claude 사용량: 턴 ${out.num_turns ?? '?'} · 입력 ${n.input} · 캐시쓰기 ${n.cacheWrite} · 캐시읽기 ${n.cacheRead} · 출력 ${n.output} · $${n.usd.toFixed(3)}`);
}

function once(args, prompt, cwd) {
  const r = spawnSync(CLAUDE_EXE, args, { input: prompt, cwd, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 5 * 60 * 1000, windowsHide: true });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* JSON 이 아니면 아래에서 던짐 */ }
  if (out) logUsage(out); // 실패한 호출도 토큰은 썼다
  if (r.status !== 0) throw new Error(`claude -p 실패: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  const text = String(out?.result ?? '').trim();
  // 앞뒤 말·코드 울타리가 붙어 와도 첫 [ … 마지막 ] 만 읽는다
  try {
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
    if (Array.isArray(arr)) return arr;
  } catch { /* 아래에서 던짐 */ }
  throw new Error(`claude 결과가 JSON 배열이 아님: ${text.slice(0, 200)}`);
}

/** prompt → JSON 배열. tools 를 주면(예: ['Read']) 그 도구만 쓰게 하고 여러 턴을 허용한다.
 *  실측: 같은 요청이 가끔 깨진 JSON 으로 온다 → 한 번 더 묻고, 그래도 실패면 던진다 */
export function askJson(prompt, { tools = [], cwd } = {}) {
  const args = ['-p', '--output-format', 'json', '--model', 'sonnet', '--max-turns', tools.length ? '12' : '1', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
  if (tools.length) args.push('--allowedTools', tools.join(','));
  try {
    return once(args, prompt, cwd);
  } catch (e) {
    console.error(`claude 다시 묻기: ${String(e.message).slice(0, 120)}`);
    return once(args, prompt, cwd);
  }
}
