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
	},
	// Vitest 4.x uses oxc by default. Explicit config ensures JSX
	// automatic runtime (no manual React imports needed in .tsx files).
	oxc: {
		jsx: { runtime: 'automatic' },
	},
});
