// 웹 푸시 받기. worker/push.ts 가 보내는 {title, body, image, url, tag} 를 알림으로 띄운다.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let m = {}
  try {
    m = e.data ? e.data.json() : {}
  } catch {
    m = { body: e.data.text() } // 개발자 도구의 글자 푸시 등
  }
  if (!m || typeof m !== 'object') m = {}
  e.waitUntil(
    self.registration.showNotification(m.title || 'Wortling', {
      body: m.body || '',
      icon: '/mascot/_default.webp',
      image: m.image || undefined,
      tag: m.tag,
      renotify: Boolean(m.tag), // 같은 종류가 알림창에 남아 있어도 다시 울린다(없으면 소리 없이 바뀜)
      data: { url: m.url || '/#/today' },
    }),
  )
})

// 누르면: 열린 창이 있으면 그 창을 앞으로(주소도 맞춤), 없으면 새로 연다
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  let url = '/#/today'
  try {
    const u = new URL(e.notification.data?.url || url, self.location.origin)
    if (u.origin === self.location.origin) url = u.href // 앱 밖 주소는 열지 않는다
  } catch {
    /* 기본값 */
  }
  e.waitUntil(
    (async () => {
      const [win] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (!win) return self.clients.openWindow(url)
      await win.focus()
      try {
        await win.navigate(url)
      } catch {
        /* 이 워커가 맡지 않은 창이면 앞으로만 */
      }
    })(),
  )
})
