import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['web/src/**/*.test.ts', 'mock/**/*.test.js', 'server/**/*.test.js'],
    environment: 'node',
    testTimeout: 15000,
  },
})
