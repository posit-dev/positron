/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
	test.skip('R - Verify Basic Reticulate Functionality using reticulate::repl_python()', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/10953' }]
	}, async function ({ app, sessions, logger }) {
		const { console } = app.workbench;

		// start new reticulate session and verify functionality
		const rSessionMetaData = await sessions.start('r');
		await console.pasteCodeToConsole('reticulate::repl_python()', true);
		await console.waitForReadyAndStarted('>>>');
		await verifyReticulateFunctionality(app, rSessionMetaData.id);
	});
});
