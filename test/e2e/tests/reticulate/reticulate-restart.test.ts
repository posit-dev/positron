/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { RETICULATE_SESSION } from './helpers/verifyReticulateFunction.js';

test.use({
	suiteId: __filename
});

// In order to run this test on Windows, I think we need to set the env var:
// RETICULATE_PYTHON
// to the installed python path

test.describe.skip('Reticulate', {
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
	}, async function ({ sessions }) {

		// start new reticulate session
		await sessions.start('pythonReticulate');
		await sessions.expectSessionPickerToBe(RETICULATE_SESSION, 60000);

		// restart reticulate session
		await sessions.restart(RETICULATE_SESSION, {
			clearConsole: true,
			waitForIdle: true,
			clickModalButton: 'Yes'
		});
		await sessions.expectAllSessionsToBeReady();
	});
});


