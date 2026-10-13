// 디스코드 웹훅 Components V2 조립(순수 함수)과 발송.
// V2 웹훅은 content/embeds/files 를 받지 않고 flags 32768 + components 만 받는다.
import type { DeckItem } from '../shared/api.ts';
import { monthDay } from './time.ts';

export const FLAG_COMPONENTS_V2 = 32768;
const ACCENT = 0x006f82;
/** 디스코드 상한: 메시지 하나에 중첩 포함 컴포넌트 40개(G7) */
export const MAX_COMPONENTS = 40;
/** 알림 글에 통계 표현 금지(G6) */
const FORBIDDEN = /연속|정답률|외운/;

export interface Component {
  type: number;
  components?: Component[];
  [k: string]: unknown;
}
export interface Payload {
  flags: number;
  components: Component[];
}

export function assertNoStats(text: string): void {
  if (FORBIDDEN.test(text)) throw new Error(`알림 글에 통계 표현 금지(G6): ${text}`);
}

export function countComponents(payload: Payload): number {
  const walk = (list: Component[]): number =>
    list.reduce((n, c) => n + 1 + (c.components ? walk(c.components) : 0), 0);
  return walk(payload.components);
}

// 부품 하나씩
const text = (content: string): Component => {
  assertNoStats(content);
  return { type: 10, content };
};
const separator = (): Component => ({ type: 14, divider: true, spacing: 1 });
const gallery = (url: string): Component => ({ type: 12, items: [{ media: { url } }] });
const linkButton = (label: string, url: string): Component => ({
  type: 1,
  components: [{ type: 2, style: 5, label, url }],
});

/** 컨테이너 하나로 감싸고 40개 상한을 확인 */
function wrap(children: Component[]): Payload {
  const payload: Payload = {
    flags: FLAG_COMPONENTS_V2,
    components: [{ type: 17, accent_color: ACCENT, components: children }],
  };
  if (countComponents(payload) > MAX_COMPONENTS) throw new Error('컴포넌트 40개 초과(G7)');
  return payload;
}

/** 'der Hund 개' 꼴 한 단어 */
export function wordLine(item: DeckItem): string {
  const w = item.word;
  return `${w.gender ? w.gender + ' ' : ''}${w.lemma} ${w.gloss_ko ?? w.gloss_en ?? ''}`.trim();
}

export function morningPayload(p: {
  day: string;
  items: DeckItem[];
  total: number;
  appUrl: string;
  imageUrl: string | null;
}): Payload {
  const words = p.items.slice(0, 5).map(wordLine);
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += 2) lines.push(words.slice(i, i + 2).join(' · '));
  const content = [`**오늘 카드 ${p.total} · ${monthDay(p.day)}**`, ...lines].join('\n');
  return wrap([
    ...(p.imageUrl ? [gallery(p.imageUrl)] : []),
    text(content),
    separator(),
    linkButton(`카드 ${p.total}장 시작`, `${p.appUrl}/#/today`),
  ]);
}

/** 남은 카드 수 → 예상 분(카드당 6초, 최소 1분) */
export function minutesFor(remaining: number): number {
  return Math.max(1, Math.ceil((remaining * 6) / 60));
}

export function eveningPayload(p: { remaining: number; minutes: number; appUrl: string }): Payload {
  return wrap([
    text(`**카드 ${p.remaining}장 남았어요**\n약 ${p.minutes}분이면 끝나요. 내일로 넘기면 복습이 쌓여요.`),
    separator(),
    linkButton('이어서', `${p.appUrl}/#/today`),
  ]);
}

export function testPayload(): Payload {
  return wrap([text('**Wortling 연결됐어요**\n내일 아침 7:30 에 첫 카드가 와요.')]);
}

/** 보관함(/api/inbox) 표시용: 제목 = 첫 굵은 줄, 본문 = 나머지, 그림 = 갤러리, 링크 = 버튼 */
export function summarize(payload: Payload): { title: string; body: string; image: string | null; link: string | null } {
  let title = '';
  let body = '';
  let image: string | null = null;
  let link: string | null = null;
  const walk = (list: Component[]) => {
    for (const c of list) {
      if (c.type === 10 && !title) {
        const [first, ...rest] = String(c.content).split('\n');
        title = first.replace(/\*\*/g, '');
        body = rest.join('\n');
      } else if (c.type === 12 && !image) {
        image = (c.items as Array<{ media: { url: string } }>)[0]?.media.url ?? null;
      } else if (c.type === 2 && !link) {
        link = String(c.url);
      }
      if (c.components) walk(c.components);
    }
  };
  walk(payload.components);
  return { title, body, image, link };
}

export interface SendResult {
  ok: boolean;
  status: number;
  messageId?: string;
  error?: string;
}

/** 웹훅으로 보내기. 4xx/5xx·네트워크 오류면 5초 뒤 한 번 더. */
export async function send(webhook: string, payload: Payload): Promise<SendResult> {
  const url = new URL(webhook);
  url.searchParams.set('with_components', 'true');
  url.searchParams.set('wait', 'true');
  const once = async (): Promise<SendResult> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 500) };
      const data = (await res.json()) as { id?: string };
      return { ok: true, status: res.status, messageId: data.id };
    } catch (e) {
      return { ok: false, status: 0, error: String(e) };
    }
  };
  const first = await once();
  if (first.ok) return first;
  await new Promise((r) => setTimeout(r, 5000));
  return once();
}
