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

    rollupOptions: {
      output: {
        /*
         * Split the dependencies away from our own code.
         *
         * The point is not the first visit — it is every visit after it. This
         * site republishes after each data run, several times a day, and with
         * one bundle a single changed line invalidates all 235 kB in the
         * visitor's cache. Recharts alone is two thirds of that and has not
         * changed in months.
         *
         * Measured: recharts 567 kB, icons 35 kB, our code plus React 233 kB.
         * After a deploy only the last of those has to travel again.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          // The package name, not a substring match: 'react' as a substring
          // also catches 'react-smooth' and 'react-transition-group', which
          // belong to recharts and would drag the chart library into the
          // entry chunk. That is exactly what happened when this was a plain
          // list — React ended up inside the recharts chunk, so every first
          // paint had to download all 167 kB of it.
          const name = id.split('node_modules/').pop()?.split('/')[0] ?? ''

          if (name === 'lucide-react') return 'icons'
          if (name === 'react' || name === 'react-dom' || name === 'scheduler') return 'react'
          return 'vendor'
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
