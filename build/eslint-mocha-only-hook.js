/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const es = require('event-stream');
const child_process = require('child_process');

const eslintMochaOnlyHook = (reporter) => {
	try {
		const result = child_process.execSync('node build/eslint-mocha-only.js', { encoding: 'utf8' });
	} catch (error) {
		let message = '';
		// See ExitCodes in build/eslint-mocha-only.js
		switch (error.status) {
			case 1:
				message = '`.only` was included in the staged test files. Please remove \`.only\` before committing, or commit with \`--no-verify\` to bypass, but this will skip all pre-commit hooks.';
				break;
			case 2:
				message = 'eslint-mocha-only wrapper script encountered an error while running the hook.';
				break;
			default:
				message = 'eslint-mocha-only encountered an error while running the hook';
				break;
		}
		reporter(message, true);
	}
	return es.through(function () {
		/* noop, important for the stream to end */
	});
};

module.exports = eslintMochaOnlyHook;
