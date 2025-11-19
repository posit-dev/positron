/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
	tag: [tags.RETICULATE, tags.WEB, tags.ARK, tags.SOFT_FAIL],
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

	test('R - Verify Basic Reticulate Functionality using reticulate::repl_python()', async function ({ app, sessions, logger }) {

		const rSessionMetaData = await sessions.start('r');

		await app.workbench.console.pasteCodeToConsole('reticulate::repl_python()', true);

		await app.workbench.console.waitForReadyAndStarted('>>>');

		await verifyReticulateFunctionality(app, rSessionMetaData.id);

	});
});
