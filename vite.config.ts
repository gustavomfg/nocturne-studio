import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

const DEV_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'"
const PROD_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

function cspPlugin(): import('vite').Plugin {
  let isDev = false
  return {
    name: 'csp',
    configResolved(config) {
      isDev = config.command === 'serve'
    },
    transformIndexHtml(html: string) {
      const csp = isDev ? DEV_CSP : PROD_CSP
      return html.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/,
        `$1${csp}$2`,
      )
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '127.0.0.1',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id)) return 'react-vendor'
        },
      },
    },
  },
  plugins: [
    cspPlugin(),
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            rolldownOptions: { external: ['better-sqlite3', 'typescript'] },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
    }),
  ],
})
