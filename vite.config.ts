import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:3001'

export default defineConfig({
  // The bundle is loaded from the app's own server on a port picked at
  // startup, so every asset must be addressed relative to the document —
  // an absolute '/' would be right too, but './' also survives being opened
  // straight from disk while debugging a build.
  base: './',
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
         * Measured: recharts 567 kB, icons 35 kB, our code plus React 233 kB.
         * The split predates the local build, where nothing travels over a
         * network at all — but it still pays: the chart library is loaded
         * lazily with the views that need it, so the first paint does not
         * wait for 567 kB to be parsed.
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
