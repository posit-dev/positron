/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const es = require('event-stream');
const child_process = require('child_process');

const eslintMochaOnlyHook = (reporter) => {
	try {
		const result = child_process.execSync('node build/eslint-mocha-only.js', { encoding: 'utf8', stdio: 'inherit' });
	} catch (error) {
		let message = '';
		let shouldFail;
		// See ExitCodes in build/eslint-mocha-only.js
		switch (error.status) {
			case 1:
				message = '`.only` was included in the staged test files. Please remove \`.only\` before committing, or commit with \`--no-verify\` to bypass, but this will skip all pre-commit hooks.';
				shouldFail = true;
				break;
			default:
				message = 'Something went wrong while running the eslint-mocha-only hook.';
				shouldFail = true;
				break;
		}
		reporter(message, shouldFail);
		if (shouldFail) {
			throw new Error(message);
		}
	}
	return es.through(function () {
		/* noop, important for the stream to end */
	});
};

module.exports = eslintMochaOnlyHook;
