/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/vs/**/*.vitest.{ts,tsx}'],
		environment: 'happy-dom',
		globals: true,
		// Auto-restore spies (vi.spyOn) between tests so a failed assertion
		// can't leave console.error/log mocked for the rest of the file.
		restoreMocks: true,
		// Clear call history on vi.fn() mocks between tests so shared
		// describe-scope fakes don't accumulate call records across tests
		// (e.g., toHaveBeenCalledWith wouldn't see stale calls from earlier
		// tests in the same file).
		clearMocks: true,
		// Provides Vitest global types (describe, it, expect, vi) for
		// intellisense in .vitest.{ts,tsx} files without a per-file
		// /// <reference> directive. Scoped to Vitest only -- does not
		// affect the main tsc compilation or Mocha tests.
		typecheck: {
			tsconfig: './vitest.tsconfig.json',
		},
	},
	// Vitest 4.x uses oxc by default. Explicit config ensures JSX
	// automatic runtime (no manual React imports needed in .tsx files).
	oxc: {
		jsx: { runtime: 'automatic' },
	},
});
