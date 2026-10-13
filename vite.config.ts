import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 개발 서버에서 /api·/img 는 wrangler dev(8787)로 넘긴다.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/img': 'http://localhost:8787',
    },
  },
})
