import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 前端统一请求 /api/*，由本地代理（proxy/server.mjs，默认 8787）转发到 forum.trae.cn。
// 这里再配一层 dev proxy，使 vite dev 与代理端口解耦，同时保留同源请求。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
})
