import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:3001'

// A Pages site lives under /<repo>/, so every asset and every prerendered JSON
// file has to be addressed relative to that prefix. Set BASE_PATH in the
// deploy workflow; locally it stays at the root.
const BASE_PATH = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base: BASE_PATH,
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
