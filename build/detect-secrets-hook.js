/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const es = require('event-stream');
const vfs = require('vinyl-fs');
const child_process = require('child_process');

module.exports = detectSecretsHook;

function detectSecretsHook(reporter) {
	try {
		const result = child_process.execSync('node build/detect-secrets.js run-hook', { encoding: 'utf8' });
	} catch (error) {
		const message = (error.status === 1) ? 'detect-secrets found at least one secret in the staged files' : 'detect-secrets encountered an error while running the hook';
		reporter(message, true);
		throw new Error(message);
	}
	return es.through(function () { /* noop, important for the stream to end */ });
}

// We'll need this if we add "detect-secrets-hook": "node build/detect-secrets-hook" to package.json
// if (require.main === module) {
// 	detectSecretsHook().on('error', (err) => {
// 		console.error();
// 		console.error(err);
// 		process.exit(1);
// 	});
// }
