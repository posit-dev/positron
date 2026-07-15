/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/vs/**/*.vitest.{ts,tsx}', 'src/*.vitest.{ts,tsx}'],
		environment: 'happy-dom',
		globals: true,
		// Registers @testing-library/jest-dom matchers (toBeInTheDocument, toHaveTextContent, etc.).
		setupFiles: ['./src/vs/test/vitest/setup.ts'],
		// Auto-restore spies between tests (failed assertion can't leave console mocked).
		restoreMocks: true,
		// Clear vi.fn() call history between tests so shared mocks don't accumulate calls.
		clearMocks: true,
		// Vitest global types for IDE intellisense; scoped to Vitest, doesn't affect main tsc.
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
