/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { verifyReticulateFunctionality } from './helpers/verifyReticulateFunction.js';

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
				'positron.reticulate.enabled': true
			}, { 'reload': 'web' });

		} catch (e) {
			await app.code.driver.takeScreenshot('reticulateSetup');
			throw e;
		}
	});

	test('R - Verify Reticulate Stop/Start Functionality', {
		tag: [tags.ARK]
	}, async function ({ app, sessions }) {

		await sessions.start('pythonReticulate');

		await app.positron.modals.installIPyKernel();

		await app.positron.console.waitForReadyAndStarted('>>>', 30000);

		await verifyReticulateFunctionality(app, `R ${process.env.POSITRON_R_VER_SEL!}`);

		await app.positron.sessions.delete(`R ${process.env.POSITRON_R_VER_SEL!}`);

		// await app.workbench.sessions.delete('Python (reticulate)'); // doesn't seem to work on exited session

		await app.positron.console.waitForConsoleContents('exited');

		await sessions.start('pythonReticulate');

		await app.positron.console.waitForReadyAndStarted('>>>', 30000);

		await app.positron.sessions.rename('reticulate', 'reticulateNew');

		await verifyReticulateFunctionality(app, `R ${process.env.POSITRON_R_VER_SEL!}`, 'reticulateNew');

	});

});

