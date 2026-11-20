import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/__tests__/**/*.test.ts', 'mobile/src/**/__tests__/**/*.int.test.ts'] }
})
