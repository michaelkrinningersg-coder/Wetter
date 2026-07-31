import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The original bundle shipped a source map to production. Keep it off by
    // default so the app is not trivially decompilable.
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
