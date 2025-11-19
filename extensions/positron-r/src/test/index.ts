/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Mocha from "mocha";
import * as path from 'path';
import { globSync } from "glob";

// This index file is not required by the vscode-test tool but is needed for our
// launch.json. The `extensionTestsPath` option expects an index file that
// exports `run()`. We manually set up Mocha (with the TDD API rather than BDD)
// and import test files.

export async function run(): Promise<void> {
	// Note again that these options only get set in debug session via launch.json
	const mocha = new Mocha.default({
		ui: "tdd",
		timeout: 60000,
	});

	const testFiles = globSync(path.join(__dirname, '*.test.js'));

	for (const file of testFiles) {
		mocha.addFile(file);
	}

	return new Promise((resolve, reject) => {
		mocha.run(failures => {
			if (failures > 0) {
				reject(new Error(`${failures} tests failed.`));
			} else {
				resolve();
			}
		});
	});
}
