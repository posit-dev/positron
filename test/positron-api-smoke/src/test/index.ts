/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { glob } from 'glob';
import Mocha from 'mocha';

/**
 * Entry point invoked by @vscode/test-electron inside the extension host.
 * Discovers and runs the compiled Mocha suites under out/test/suite.
 */
export async function run(): Promise<void> {
	const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 20_000 });
	const testsRoot = __dirname;

	const files = await glob('suite/**/*.test.js', { cwd: testsRoot });
	files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

	await new Promise<void>((resolve, reject) => {
		mocha.run((failures) => {
			if (failures > 0) {
				reject(new Error(`${failures} test(s) failed.`));
			} else {
				resolve();
			}
		});
	});
}
