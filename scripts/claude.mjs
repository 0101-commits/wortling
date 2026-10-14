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

function once(args, prompt, cwd) {
  const r = spawnSync(CLAUDE_EXE, args, { input: prompt, cwd, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 5 * 60 * 1000, windowsHide: true });
  if (r.status !== 0) throw new Error(`claude -p 실패: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  const text = String(JSON.parse(r.stdout).result ?? '').trim();
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
