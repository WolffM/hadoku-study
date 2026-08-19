import { defineConfig } from 'vitest/config'

/**
 * Separate from `vite.config.ts` on purpose: that config exists to emit the
 * micro-frontend bundle, and its `build.lib` and externals have nothing to say
 * about a test run — externalizing React would break any test that rendered.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node'
  }
})
