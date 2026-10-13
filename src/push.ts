// 이 기기로 알림 받기: 서비스 워커(public/sw.js) 등록 → 권한 → 구독 → 서버에 알림(/api/push/*)
import { api } from './api.ts'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** 이 기기가 지금 구독 중인가. 구독 중이면 서버 목록에도 다시 올린다 — 등록이 중간에 실패했거나
 *  서버가 목록에서 뺐어도(상한 10대 등) 화면이 「켜짐」인 채 알림이 안 오는 일이 없게(같은 주소면 덮어씀) */
export async function pushSync(): Promise<boolean> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return false
  await api.pushSubscribe(sub.toJSON()).catch(() => undefined)
  return true
}

/** 켜기. 권한을 거절하면 Error('denied') */
export async function enablePush(): Promise<void> {
  // 권한부터 — 다른 await 뒤에 물으면 Safari·Firefox 가 누른 동작이 지났다고 창을 안 띄울 수 있다
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('denied')
  await navigator.serviceWorker.register('/sw.js')
  const { publicKey } = await api.pushKey()
  // base64url → 바이트(문자열 그대로는 받지 않는 브라우저가 있다)
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  const reg = await navigator.serviceWorker.ready // 구독은 워커가 활성일 때만 된다
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  try {
    await api.pushSubscribe(sub.toJSON())
  } catch (e) {
    await sub.unsubscribe().catch(() => undefined) // 서버가 모르는 구독을 남기면 다음에 「켜짐」으로 보인다
    throw e
  }
}

/** 끄기. 서버 목록에서 못 지워도 다음 발송 때 410 으로 빠진다 */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined)
}
