/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'happy-dom',
		include: ['src/vs/**/*.vitest.ts', 'src/vs/**/*.vitest.tsx'],
		setupFiles: ['./src/vs/base/test/common/vitestSetup.ts'],
		testTimeout: 10000,
	},
	resolve: {
		extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
	},
	esbuild: {
		tsconfigRaw: {
			compilerOptions: {
				experimentalDecorators: true,
				jsx: 'react-jsx',
			},
		},
	},
});
