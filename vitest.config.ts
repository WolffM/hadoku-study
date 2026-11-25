import { defineConfig } from 'vitest/config'
import { APP_NAME } from './app-name'

/**
 * Separate from `vite.config.ts` on purpose: that config exists to emit the
 * micro-frontend bundle, and its `build.lib` and externals have nothing to say
 * about a test run — externalizing React would break any test that rendered.
 */
export default defineConfig({
  define: {
    // The same build-time constant vite.config.ts injects. Without it the app
    // hits a ReferenceError on render and every DOM query fails on an empty body.
    __HADOKU_APP_NAME__: JSON.stringify(APP_NAME)
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // The JSON report is what CI's report-tests step reads: every test's
    // outcome and time, into the fleet test store (hadoku_site
    // docs/planning/unified-test-reporting-2026-11-23.md). Keep reporters HERE:
    // a `--reporter` on the command line replaces this list and drops the report.
    reporters: ['default', 'json'],
    outputFile: { json: 'reports/vitest.json' }
  }
})
