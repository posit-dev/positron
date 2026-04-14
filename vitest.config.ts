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
	oxc: {
		jsx: { runtime: 'automatic' },
	},
});
