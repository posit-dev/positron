/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

/**
 * Vitest collects `extensions/**\/*.vitest.{ts,tsx}`, and an extension's own build compiles
 * `src/**` too. Without a `.vitest.` exclude in that extension's tsconfig, the test compiles
 * into `out/` and ships inside the extension, where its `vitest` import cannot resolve at
 * runtime. Nothing else catches this: `compile-extension` runs tsgo straight off the
 * extension's tsconfig and bypasses the gulp pipeline, `.vscodeignore` excludes `src/**` but
 * not `out/**`, and the `.vitest.` filter in `build/lib/compilation.ts` applies only to the
 * core `src` build. The build stays green either way, so this has to be a test rather than a
 * compiler error. See `.claude/rules/vitest-tests.md#tests-inside-extensions`.
 *
 * This resolves each extension's tsconfig the same way its real build does, and fails if a
 * `.vitest.` file would be included in the result.
 */
function resolvedFileNames(tsconfigPath: string): string[] {
	const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
	if (error) {
		throw new Error(`Cannot parse ${tsconfigPath}: ${error.messageText}`);
	}
	return ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(tsconfigPath)).fileNames;
}

// `__dirname` is this file's own directory (`extensions/`), so the path holds wherever Vitest
// is started from. See vitest-tests.md on why `process.cwd()` and `import.meta.url` don't.
const extensionNames = fs.readdirSync(__dirname)
	.filter(name => fs.existsSync(path.join(__dirname, name, 'tsconfig.json')));

describe('extension builds exclude vitest files', () => {
	it.each(extensionNames)('%s', name => {
		const tsconfigPath = path.join(__dirname, name, 'tsconfig.json');
		const includedVitestFiles = resolvedFileNames(tsconfigPath).filter(f => f.includes('.vitest.'));

		expect(includedVitestFiles).toEqual([]);
	});
});
