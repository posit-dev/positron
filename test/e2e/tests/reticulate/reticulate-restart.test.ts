/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// In order to run this test on Windows, I think we need to set the env var:
// RETICULATE_PYTHON
// to the installed python path

test.describe('Reticulate', {
	tag: [tags.RETICULATE, tags.WEB],
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		try {
			await settings.set({
				'positron.reticulate.enabled': true,
			}, { 'reload': 'web' });

		} catch (e) {
			await app.code.driver.takeScreenshot('reticulateSetup');
			throw e;
		}
	});

	test('R - Verify Reticulate Restart', {
		tag: [tags.RETICULATE, tags.CONSOLE]
	}, async function ({ app, sessions }) {

		await sessions.start('pythonReticulate');

		await app.workbench.sessions.expectSessionPickerToBe('Python (reticulate)');

		await app.workbench.console.clearButton.click();

		await app.workbench.sessions.restart('Python (reticulate)', { waitForIdle: false });

		await app.code.driver.page.locator('.positron-modal-dialog-box').getByRole('button', { name: 'Yes' }).click();

		await app.workbench.console.waitForReadyAndStarted('>>>', 30000);

	});
});


