/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This script can be run standalone from the root of the project to check for `.only` in staged
// test files with `node build/detect-dot-only.js`.
// It is also run in the pre-commit/hygiene tasks to check for `.only` in staged test files.

import child_process from 'child_process';
import colors from 'colors';
import readline from 'readline/promises';

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
	// console.error('[DETECT DOT ONLY DEBUG] Getting staged files...'.cyan);
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
	// console.error(`[DETECT DOT ONLY DEBUG] Staged test files: ${files}`.cyan);
	if (!files) {
		// console.error('[DETECT DOT ONLY DEBUG] No staged test files found. Skipping .only checks.'.cyan);
		process.exit(ExitCodes.SUCCESS);
	}
	// Detect test files with `.only` in the staged files, without running the tests
	const result = child_process.execSync(
		`npx playwright test --list --forbid-only ${files}`,
		{
			encoding: 'utf8',
			stdio: 'pipe' // pipe the output so we can choose how to print it in the catch block
		}
	);
	process.exit(ExitCodes.SUCCESS);
} catch (error) {
	// Playwright seems to always return error code 1, regardless of the error, so we need to check
	// the stderr text to determine the actual error.

	// If the stderr includes 'forbid-only', it means that `.only` was found in the staged test(s).
	if (error.stderr.includes('forbid-only')) {
		console.error(
			`\nLooks like you may have included \`.only\` in your test(s)!`.magenta
		);
		// Playwright's output indicating the file(s) with `.only` will be printed to stderr
		console.error(error.stderr);
		process.exit(ExitCodes.ONLY_COMMITTED_FAIL_HOOK);
	}

	// If the stderr includes 'No tests found', this means that the staged test files are not
	// recognized as test files by Playwright and the check should be skipped.
	if (error.stderr.includes('No tests found')) {
		console.error(
			`Playwright did not find tests in the staged files. Skipping .only checks.`
		);
		// console.error(`[DETECT DOT ONLY DEBUG] ${JSON.stringify(error, null, 4)}`.cyan);
		process.exit(ExitCodes.SUCCESS);
	}

	// Otherwise, some other error occurred
	console.error(`Error occurred when running Playwright:\n${JSON.stringify(error, null, 4)}`.red);
	process.exit(ExitCodes.ERROR);
}
