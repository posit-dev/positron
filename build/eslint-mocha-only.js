/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
		process.exit(ExitCodes.SUCCESS);
	}
	// Non-ideal way to fail on `only` being used in mocha tests
	const result = child_process.execSync(
		`npx eslint --rule 'mocha/no-exclusive-tests: error' ${files}`,
		{ encoding: 'utf8' }
	);
	process.exit(ExitCodes.SUCCESS);
} catch (error) {
	console.error(
		`It looks like you've included \`.only\` in your test(s):\n`.cyan +
		`${error.stdout}` +
		'If you end up committing with \`.only\`: just a friendly reminder to remove `.only` from your tests before merging to `main` :)'.magenta
	);
	process.exit(ExitCodes.ONLY_COMMITTED_FAIL_HOOK);
}
