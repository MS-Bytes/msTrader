import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
    build: {
      lib: { entry: resolve(__dirname, 'electron/main.ts') },
      rollupOptions: { external: ['better-sqlite3'] },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
    build: {
      lib: { entry: resolve(__dirname, 'electron/preload.ts') },
    },
  },
  renderer: {
    root: 'src',
    plugins: [react()],
    resolve: {
      alias: { '@': resolve(__dirname, 'src'), '@shared': resolve(__dirname, 'shared') },
    },
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') },
    },
    worker: { format: 'es' },
  },
})
