/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import { createBrowserFetchableTest } from '../pwbGzip.ts';

suite('createBrowserFetchableTest', () => {
	const isBrowserFetchable = createBrowserFetchableTest(['@vscode/codicons', 'katex']);

	test('accepts only files the browser can fetch', () => {
		const paths = [
			'out/vs/code/browser/workbench/workbench.js',
			'node_modules/@vscode/codicons/dist/codicon.css',
			'node_modules/katex/dist/katex.min.js',
			'extensions/theme-defaults/themes/dark_modern.json',
			'extensions/copilot/dist/extension.js',
			'node_modules/@azure/identity/dist/index.js',
			'node_modules/katex-extra/index.js',
			'node_modules/@vscode/codicons-extra/index.js',
			'extensions/copilot/node_modules/zod/index.js',
			'extensions/node_modules/typescript/lib/typescript.js',
			'quarto/share/deno_std/cache/mod.js',
			'product.json',
		];
		assert.deepStrictEqual(
			paths.filter(isBrowserFetchable),
			[
				'out/vs/code/browser/workbench/workbench.js',
				'node_modules/@vscode/codicons/dist/codicon.css',
				'node_modules/katex/dist/katex.min.js',
				'extensions/theme-defaults/themes/dark_modern.json',
				'extensions/copilot/dist/extension.js',
			]
		);
	});

	test('accepts Windows path separators', () => {
		assert.deepStrictEqual(
			[
				'out\\vs\\workbench\\workbench.web.main.js',
				'extensions\\copilot\\node_modules\\zod\\index.js',
			].map(isBrowserFetchable),
			[true, false]
		);
	});
});
