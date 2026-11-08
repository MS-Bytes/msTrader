import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * Browser-only dev config: runs the renderer in a normal browser tab using the
 * in-page simulated feed + localStorage shim (see src/services/bridge.ts).
 * Handy for rapid UI work without launching Electron: `pnpm dev:web`.
 */
export default defineConfig({
  root: 'src',
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src'), '@shared': resolve(__dirname, 'shared') },
  },
  server: { port: 5174, strictPort: true },
  worker: { format: 'es' },
})
