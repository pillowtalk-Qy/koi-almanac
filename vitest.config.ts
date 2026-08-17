import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['worker/**/*.test.ts', 'node_modules/**'],
  },
})
