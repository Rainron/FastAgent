import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { sourcemap: false, minify: 'esbuild' } },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: false,
      rollupOptions: {
        // 启动页用独立 preload：它只需要一条接收通道，不该拿到主界面的完整 API。
        input: { index: resolve('src/preload/index.ts'), splash: resolve('src/preload/splash.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer'), '@shared': resolve('src/shared') } },
    plugins: [react(), tailwindcss()],
    build: {
      sourcemap: false,
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html'), splash: resolve('src/renderer/splash.html') }
      }
    }
  }
})
