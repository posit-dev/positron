/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// In order to run this test on Windows, I think we need to set the env var:
// RETICULATE_PYTHON to the installed python path

test.describe('Reticulate - Variables pane support', {
	tag: [tags.RETICULATE, tags.WEB, tags.SOFT_FAIL],
}, () => {
	test('R - Verify Reticulate formats variables in the Variables pane', async function ({ app, sessions, logger }) {
		// Reticulate relies on some Positron internals to format variables in the Variables pane.
		// If the internals change it can cause reticulate variable formatting to break.
		// This allows us to learn if we regress on that functionality.
		const { console, variables } = app.workbench;

		await sessions.start('r');

		await console.pasteCodeToConsole('supported <- packageVersion("reticulate") >= "1.44.1"', true);
		await console.waitForExecutionComplete();

		try {
			await variables.expectVariableToBe('supported', 'TRUE');
		} catch (e) {
			// skip if not supported version
			logger.log('Reticulate version does not support variable inspection. Skipping test.');
			return;
		}

		await console.pasteCodeToConsole('np <- reticulate::import("numpy", convert = FALSE)', true);
		await console.waitForExecutionComplete();

		await console.pasteCodeToConsole('arr <- np$array(c(1L, 2L, 3L))', true);
		await console.waitForExecutionComplete();

		await variables.expectVariableToBe('np', /^<module \'numpy\' from/);
		await variables.expectVariableToBe('arr', '[1,2,3]');
	});
});
