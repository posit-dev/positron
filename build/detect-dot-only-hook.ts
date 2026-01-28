/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import child_process from 'child_process';
import es from 'event-stream';

export type DotOnlyHookReporter = (message: string, isError: boolean) => void;

export default function detectDotOnlyHook(reporter: DotOnlyHookReporter): NodeJS.ReadWriteStream {
	// If SKIP_DOT_ONLY_CHECK is set, skip the check
	if (process.env.SKIP_DOT_ONLY_CHECK) {
		reporter('Skipping .only check for staged test files because SKIP_DOT_ONLY_CHECK is set\n', false);
		return es.through(function () {
			/* noop, important for the stream to end */
		});
	}

	try {
		child_process.execSync('node build/detect-dot-only.js', { encoding: 'utf8' });
	} catch (error) {
		let message = '';
		// See ExitCodes in build/detect-dot-only.js
		switch ((error as { status?: number }).status) {
			case 1:
				message = 'If you want to skip the .only check, set SKIP_DOT_ONLY_CHECK in your environment.\n\te.g., `SKIP_DOT_ONLY_CHECK=1 git commit`';
				break;
			case 2:
				message = 'detect-dot-only.js encountered an error...';
				break;
			default:
				message = 'Encountered an error while running the hook to detect .only in staged test files.';
				break;
		}
		reporter(message + '\n', true);

		// Exit the process with an error so that the pre-commit hook fails
		process.exit((error as { status?: number }).status);
	}

	return es.through(function () {
		/* noop, important for the stream to end */
	});
}
