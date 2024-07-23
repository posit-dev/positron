/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This script can be run standalone from the root of the project to check for `.only` in staged
// test files with `node build/eslint-mocha-only.js`.
// It is also run in the pre-commit/hygiene tasks to check for `.only` in staged test files.

const child_process = require('child_process');
const colors = require('colors');
const readline = require('readline/promises');

// Enum for exit codes
const ExitCodes = {
	SUCCESS: 0,                  // success
	ONLY_COMMITTED_FAIL_HOOK: 1, // fail since `.only` was found in the staged test files
	ERROR: 2,                    // something else went wrong
};

// git -z option is used to separate file names with null characters
// Split the output by null characters and remove empty strings, then join the files with a
// space so that they can be passed as arguments
const getStagedTestFiles = () => {
	try {
		return (
			child_process
				.execSync('git diff --cached --name-only -z', {
					encoding: 'utf8',
				})
				.split('\0')
				.filter((x) => !!x)
				// Non-ideal way to filter for test files
				.filter((x) => x.endsWith('.test.ts'))
				.join(' ')
		);
	} catch (error) {
		console.error(`Error: Could not get staged files: ${error}`.red);
		process.exit(ExitCodes.ERROR);
	}
};

try {
	const files = getStagedTestFiles();
	if (!files) {
		console.log('No staged test files found. Skipping eslint-mocha-only hook.'.cyan);
		process.exit(ExitCodes.SUCCESS);
	}
	// Non-ideal way to fail on `only` being used in mocha tests without triggering other linting rules.
	const result = child_process.execSync(
		`npx eslint --no-eslintrc --parser '@typescript-eslint/parser' --plugin 'mocha' --rule 'mocha/no-exclusive-tests: error' ${files}`,
		{ encoding: 'utf8' }
	);
	process.exit(ExitCodes.SUCCESS);
} catch (error) {
	console.error(
		`It looks like you've included \`.only\` in your test(s):\n`.magenta +
		`${error.stdout}`
	);
	process.exit(ExitCodes.ONLY_COMMITTED_FAIL_HOOK);
}
