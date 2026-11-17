import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const envDir = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(({ mode }) => {
  // 只讀取代理目標；不把任何 .env 值暴露給瀏覽器端程式
  const env = loadEnv(mode, envDir, '')
  const target = process.env.BACKEND_URL || env.BACKEND_URL || 'http://localhost:3000'
  const port = Number(process.env.WEB_PORT || 5173)

  return {
    root,
    envDir,
    plugins: [vue()],
    server: {
      port,
      strictPort: true,
      proxy: {
        '/api': { target, changeOrigin: false },
        '/socket.io': { target, ws: true, changeOrigin: false },
      },
    },
    build: {
      outDir: fileURLToPath(new URL('../dist', import.meta.url)),
      emptyOutDir: true,
    },
  }
})
