import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: false,
      minify: 'esbuild',
      rollupOptions: {
        // dsh 插件宿主跑在独立 utilityProcess 里，需要单独一个入口产物。
        input: { index: resolve('src/main/index.ts'), 'dsh-host': resolve('src/main/dsh/host-entry.ts') },
        output: { entryFileNames: '[name].js' }
      }
    }
  },
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
    server: { host: '127.0.0.1' },
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
