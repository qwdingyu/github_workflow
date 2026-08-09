import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const frontendSrc = resolve(root, 'frontend/src')
const frontendVue = resolve(root, 'frontend/node_modules/vue')
const kitPkg = resolve(root, 'frontend/node_modules/@usethink/cf-admin-fe')

export default defineConfig({
  resolve: {
    // Longer / more specific aliases first so bare package does not swallow subpaths.
    alias: [
      {
        find: '@usethink/cf-admin-fe/composables',
        replacement: resolve(kitPkg, 'src/composables/index.ts'),
      },
      {
        find: '@usethink/cf-admin-fe/utils',
        replacement: resolve(kitPkg, 'src/utils/index.ts'),
      },
      {
        find: '@usethink/cf-admin-fe/components',
        replacement: resolve(kitPkg, 'src/components/index.ts'),
      },
      {
        find: '@usethink/cf-admin-fe/i18n',
        replacement: resolve(kitPkg, 'src/i18n/index.ts'),
      },
      {
        find: '@usethink/cf-admin-fe',
        replacement: resolve(kitPkg, 'src/index.ts'),
      },
      { find: '@', replacement: frontendSrc },
      { find: 'vue', replacement: frontendVue },
    ],
  },
  test: {
    environment: 'node',
    testTimeout: 60_000,
    fileParallelism: false,
    maxWorkers: 1,
    include: ['src/**/*.test.ts', 'frontend/src/**/*.test.ts'],
  },
})
