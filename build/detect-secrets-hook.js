/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const es = require('event-stream');
const child_process = require('child_process');

module.exports = detectSecretsHook;

function detectSecretsHook(reporter) {
	try {
		const result = child_process.execSync('node build/detect-secrets.js run-hook', { encoding: 'utf8' });
	} catch (error) {
		let message = '';
		// See ExitCodes in build/detect-secrets.js
		switch (error.status) {
			case 1:
				message = 'detect-secrets found secrets in the staged files or there was an issue with the .secrets.baseline file';
				break;
			case 2:
				message = 'detect-secrets wrapper script encountered an error while running the hook';
				break;
			default:
				message = 'detect-secrets encountered an error while running the hook';
				break;
		}
		reporter(message, true);
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
