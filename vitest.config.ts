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
