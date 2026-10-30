// 아이솔레이트 안 짧은 기억(KV 쓰기는 하루 1,000번뿐이라 안 쓴다). D1 객체별로 따로 두어 시험이 섞이지 않는다.
// 요청마다 감싼 D1(meterDb)은 매번 다른 객체라, 원래 D1 을 열쇠로 삼는다
const raws = new WeakMap<object, object>();
export const bindOwner = (wrapped: object, raw: object) => raws.set(wrapped, raw);
const ownerOf = (o: object) => raws.get(o) ?? o;
const stores = new WeakMap<object, Map<string, { at: number; v: unknown }>>();

/** key 로 ttlMs 동안 결과를 기억. 같은 때 겹쳐 불러도 한 번만 계산(약속을 기억) */
export function memo<T>(owner: object, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  owner = ownerOf(owner);
  let m = stores.get(owner);
  if (!m) stores.set(owner, (m = new Map()));
  const hit = m.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as Promise<T>;
  const p = fn();
  m.set(key, { at: Date.now(), v: p });
  p.catch(() => m.delete(key)); // 실패는 기억하지 않는다
  return p;
}

/** 쓰기(채점·단어 추가·고치기) 뒤에 세기 기억을 비운다(같은 아이솔레이트 안에서만 닿는다 — 나머지는 TTL) */
export function clearMemo(owner: object): void {
  stores.delete(ownerOf(owner));
}
