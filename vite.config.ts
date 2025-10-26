import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    fs: {
      // Allow serving files from node_modules
      allow: ['..'],
    },
  },
  optimizeDeps: {
    exclude: ['mupdf'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  worker: {
    format: 'es',
  },
})
