import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    dedupe: ['vue'],
    alias: {
      // Single Vue instance for @usethink/cf-admin-fe peer types
      vue: resolve(__dirname, 'node_modules/vue'),
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    target: 'es2020',
    outDir: '../public',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router'],
        },
      },
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
      '/sign-in': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
      '/consent': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
})
