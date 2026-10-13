import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RegionConfig, ThemeProvider } from '@montage-ui/core'
import '@montage-ui/core/global.css'
import './theme.css'
import './app.css'
import { takeTokenFromUrl } from './api.ts'
import App from './App.tsx'

takeTokenFromUrl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      {/* 토스트가 아래 탭(56px) 위에 뜨도록 */}
      <RegionConfig viewportBottom={76} viewportMaxWidth={480} />
      <App />
    </ThemeProvider>
  </StrictMode>,
)
