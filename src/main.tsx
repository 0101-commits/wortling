import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RegionConfig, ThemeProvider } from '@montage-ui/core'
import '@montage-ui/core/global.css'
import './theme.css'
import './app.css'
import { takeTokenFromUrl } from './api.ts'
import { takeShareFromUrl } from './share.ts'
import App from './App.tsx'

takeTokenFromUrl()
takeShareFromUrl()

// 확대·축소 막기(앱처럼). iOS Safari 는 viewport 의 user-scalable=no 를 무시하므로 손가락 두 개 동작을 직접 막는다.
// 한 손가락 밀기(덱)는 그대로 둔다.
const stop = (e: Event) => e.preventDefault()
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false })
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      {/* 토스트가 아래 탭(56px) 위에 뜨도록 */}
      <RegionConfig viewportBottom={76} viewportMaxWidth={480} />
      <App />
    </ThemeProvider>
  </StrictMode>,
)
