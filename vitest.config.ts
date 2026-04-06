/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: 'happy-dom',
		include: [
			'src/vs/**/*.vitest.ts',
			'src/vs/**/*.vitest.tsx',
			'extensions/positron-*/src/test/**/*.vitest.ts',
			'extensions/positron-*/src/test/**/*.vitest.tsx',
		],
		setupFiles: ['./src/vs/base/test/common/vitestSetup.ts'],
		testTimeout: 10000,
	},
	resolve: {
		extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
		alias: [
			{ find: 'vscode', replacement: resolve(__dirname, 'src/vs/base/test/common/vscode-stub.ts') },
			{ find: 'positron', replacement: resolve(__dirname, 'src/vs/base/test/common/positron-stub.ts') },
			{ find: 'p-queue', replacement: resolve(__dirname, 'src/vs/base/test/common/p-queue-stub.ts') },
			{ find: 'split2', replacement: resolve(__dirname, 'src/vs/base/test/common/split2-stub.ts') },
			{ find: 'vscode-languageclient/node', replacement: resolve(__dirname, 'src/vs/base/test/common/vscode-languageclient-stub.ts') },
			{ find: 'vscode-languageclient', replacement: resolve(__dirname, 'src/vs/base/test/common/vscode-languageclient-stub.ts') },
			// The git extension API is imported for types only; stub it so vitest can resolve it
			{
				find: /.*\/git\/src\/api\/git\.js$/,
				replacement: resolve(__dirname, 'src/vs/base/test/common/git-api-stub.ts'),
			},
		],
		// Include extension node_modules directories so vitest can resolve
		// packages that are installed per-extension (e.g., 'ai', 'openai')
		modules: [
			resolve(__dirname, 'node_modules'),
			resolve(__dirname, 'extensions/positron-assistant/node_modules'),
			resolve(__dirname, 'extensions/positron-r/node_modules'),
		],
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
