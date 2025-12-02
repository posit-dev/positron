/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

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
			});

		} catch (e) {
			await app.code.driver.takeScreenshot('reticulateSetup');
			throw e;
		}

		await app.restart();
	});

	test('R - Verify Reticulate Restart', {
		tag: [tags.RETICULATE, tags.CONSOLE]
	}, async function ({ app, sessions }) {

		await sessions.start('pythonReticulate');

		await app.workbench.sessions.expectSessionPickerToBe('Python (reticulate)', 60000);

		await app.workbench.sessions.restart('Python (reticulate)', { waitForIdle: false });

		await app.code.driver.page.locator('.positron-modal-dialog-box').getByRole('button', { name: 'Yes' }).click();

		// doesn't support 2 or 1 instance of started:
		// await app.workbench.console.waitForReadyAndStarted('>>>', 30000, 2);

		await test.step('Wait for console to be ready and started', async () => {
			await app.workbench.console.waitForReady('>>>', 30000);

			const matchingLines = app.code.driver.page.locator('.console-instance[style*="z-index: auto"]  div span').getByText('started');

			await Promise.any([
				expect(matchingLines).toHaveCount(1, { timeout: 30_000 }),
				expect(matchingLines).toHaveCount(2, { timeout: 30_000 }),
			]);
		});

	});
});


