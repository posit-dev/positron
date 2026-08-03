/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from './_test.setup';
import { verifyReticulateFunctionality } from './helpers/verifyReticulateFunction.js';

test.use({
	suiteId: __filename
});

// In order to run this test on Windows, I think we need to set the env var:
// RETICULATE_PYTHON
// to the installed python path

test.describe('Reticulate', {
	tag: [tags.RETICULATE, tags.WEB, tags.ARK, tags.SOFT_FAIL],
}, () => {
	// Skipped: execute requests sent to the reticulate Python session hang in CI, so the
	// variable never appears and the test spins until it times out. Un-skip when #10953 is fixed.
	test.skip('R - Verify Basic Reticulate Functionality using reticulate::repl_python() with multiple sessions', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/10953' }]
	}, async function ({ app, sessions, logger }) {
		const { console } = app.workbench;

		// start R session and start reticulate within it
		const rSessionMetaData = await sessions.start('r');
		await console.pasteCodeToConsole('reticulate::repl_python()', true);
		await console.waitForReadyAndStarted('>>>');

		// rename reticulate session to: sessionOne and verify functionality
		await sessions.rename('reticulate', 'sessionOne');
		await verifyReticulateFunctionality(app, rSessionMetaData.id, 'sessionOne');

		// start a second R session and start reticulate within it
		const rSessionMetaData2 = await sessions.start('r', { reuse: false });
		await console.pasteCodeToConsole('reticulate::repl_python()', true);
		await console.waitForReadyAndStarted('>>>');

		// rename reticulate session to: sessionTwo and verify functionality
		await sessions.rename('reticulate', 'sessionTwo');
		await verifyReticulateFunctionality(app, rSessionMetaData2.id, 'sessionTwo', '300', '500', '7');
	});
});
