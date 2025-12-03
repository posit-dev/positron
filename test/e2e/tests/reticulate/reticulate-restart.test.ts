/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { ACTIVE_CONSOLE_INSTANCE } from '../../pages/console.js';

test.use({
	suiteId: __filename
});

// In order to run this test on Windows, I think we need to set the env var:
// RETICULATE_PYTHON
// to the installed python path

test.describe('Reticulate', {
	tag: [tags.RETICULATE, tags.WEB, tags.SOFT_FAIL],
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		try {
			await settings.set({
				'positron.reticulate.enabled': true,
				'kernelSupervisor.transport': 'tcp'
			}, { reload: true });

		} catch (e) {
			await app.code.driver.takeScreenshot('reticulateSetup');
			throw e;
		}
	});

	test('R - Verify Reticulate Restart', {
		tag: [tags.RETICULATE, tags.CONSOLE]
	}, async function ({ app }) {
		const { console, sessions, modals } = app.workbench;

		// start new reticulate session
		await sessions.start('pythonReticulate');
		await sessions.expectSessionPickerToBe('Python (reticulate)', 60000);

		// restart reticulate session
		await sessions.restart('Python (reticulate)', { waitForIdle: false });
		await modals.clickButton('Yes');

		// verify reticulate restarted
		await console.waitForReadyAndStarted('>>>', 30000);
		await expect(app.code.driver.page.locator(ACTIVE_CONSOLE_INSTANCE).getByText('started').first()).toBeVisible({ timeout: 90000 });
	});
});


