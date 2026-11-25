import { defineConfig } from 'vitest/config';

/**
 * Separate from `vite.config.ts` on purpose: that config exists to emit the
 * published bundle and loads `vite-plugin-dts`, which has no business running
 * for a test pass.
 */
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		// CI's report-tests step reads this (see the root vitest.config.ts).
		reporters: ['default', 'json'],
		outputFile: { json: 'reports/vitest.json' },
	},
});
