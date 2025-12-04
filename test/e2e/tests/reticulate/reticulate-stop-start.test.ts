/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { RETICULATE_SESSION, verifyReticulateFunctionality } from './helpers/verifyReticulateFunction.js';

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

	test('R - Verify Reticulate Stop/Start Functionality', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		const { console, sessions, modals } = app.workbench;

		// start new reticulate session and verify functionality
		const reticulateSession = await sessions.start('pythonReticulate');
		await modals.installIPyKernel();
		await sessions.expectSessionPickerToBe(RETICULATE_SESSION, 60000);
		await verifyReticulateFunctionality(app, `R ${process.env.POSITRON_R_VER_SEL!}`);

		// stop reticulate session
		await sessions.select(reticulateSession.id);
		await sessions.delete(reticulateSession.id);
		await console.waitForConsoleContents('exited', { timeout: 30000 });

		// start reticulate session (again) and verify functionality
		await sessions.start('pythonReticulate');
		await sessions.expectSessionPickerToBe(RETICULATE_SESSION, 60000);
		await sessions.rename('reticulate', 'reticulateNew');
		await verifyReticulateFunctionality(app, `R ${process.env.POSITRON_R_VER_SEL!}`, 'reticulateNew');
	});
});
