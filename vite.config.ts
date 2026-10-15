import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

const desktopAssetsDir = path.resolve(__dirname, 'desktop-assets')

const contentTypes: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.gz': 'application/gzip',
}

/**
 * Desktop build: serve and bundle the offline OCR/model assets fetched by
 * scripts/fetch-desktop-assets.mjs, and drop the CDN script used on the web.
 */
function desktopAssets(): Plugin {
  return {
    name: 'safe-redact-desktop-assets',
    configResolved() {
      if (!fs.existsSync(desktopAssetsDir)) {
        throw new Error('desktop-assets/ is missing. Run `node scripts/fetch-desktop-assets.mjs` first.')
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '').split('?')[0])
        if (!urlPath.startsWith('/vendor/') && !urlPath.startsWith('/models/')) return next()
        const filePath = path.join(desktopAssetsDir, urlPath)
        if (!filePath.startsWith(desktopAssetsDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.statusCode = 404
          return res.end()
        }
        res.setHeader('Content-Type', contentTypes[path.extname(filePath)] ?? 'application/octet-stream')
        fs.createReadStream(filePath).pipe(res)
      })
    },
    transformIndexHtml(html) {
      return html.replace(/\s*<!-- v5 -->\s*<script src='https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, '')
    },
    closeBundle() {
      fs.cpSync(desktopAssetsDir, path.resolve(__dirname, 'dist'), { recursive: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    mode === 'desktop' && desktopAssets(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
  },
  // Tauri expects a fixed port and prints its own logs
  clearScreen: mode !== 'desktop',
  server: {
    strictPort: mode === 'desktop',
    headers: {
      // WebKit does not support credentialless; the desktop app loads everything from its own origin
      'Cross-Origin-Embedder-Policy': mode === 'desktop' ? 'require-corp' : 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    fs: {
      // Allow serving files from node_modules
      allow: ['..'],
    },
    watch: {
      ignored: ['**/src-tauri/**', '**/desktop-assets/**'],
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
}))
