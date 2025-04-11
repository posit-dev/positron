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
	test.beforeAll(async function ({ app, userSettings }) {
		try {
			await userSettings.set([
				['positron.reticulate.enabled', 'true']
			]);

		} catch (e) {
			await app.code.driver.takeScreenshot('reticulateSetup');
			throw e;
		}
	});

	test('R - Verify Reticulate Stop/Start Functionality', async function ({ app, sessions }) {

		await sessions.start('pythonReticulate');

		await app.workbench.popups.installIPyKernel();

		await app.workbench.console.waitForReadyAndStarted('>>>', 30000);


		await verifyReticulateFunctionality(app, `R ${process.env.POSITRON_R_VER_SEL!}`);

		await app.workbench.sessions.delete(`R ${process.env.POSITRON_R_VER_SEL!}`);

		await app.workbench.sessions.delete('Python (reticulate)');

		await sessions.start('pythonReticulate');

		await app.workbench.console.waitForReadyAndStarted('>>>', 30000);

		await verifyReticulateFunctionality(app, `R ${process.env.POSITRON_R_VER_SEL!} - 2`, 'Python (reticulate) - 2');

	});

});

