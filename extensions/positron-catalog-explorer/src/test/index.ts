/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
	// Create the mocha test runner
	const mocha = new Mocha.default({
		ui: 'tdd', // Using TDD interface: suite, test, etc.
		color: true,
		timeout: 10000, // Longer timeout for VS Code startup
	});

	const testsRoot = path.resolve(__dirname);

	try {
		// Find all test files recursively
		const files = await glob('**/*.test.js', { cwd: testsRoot });

		// Add all files to the test suite
		files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

		console.log(`Found ${files.length} test files to run`);

		// Run the mocha tests and return a promise
		return new Promise<void>((resolve, reject) => {
			try {
				mocha.run((failures) => {
					if (failures > 0) {
						reject(new Error(`${failures} tests failed.`));
					} else {
						resolve();
					}
				});
			} catch (err) {
				console.error('Error running tests:', err);
				reject(err);
			}
		});
	} catch (err) {
		console.error('Error finding test files:', err);
		throw err;
	}
}
