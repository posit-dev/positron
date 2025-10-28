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
	tag: [tags.RETICULATE, tags.WEB, tags.ARK],
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

	test('R - Verify Basic Reticulate Functionality using reticulate::repl_python() with multiple sessions', async function ({ app, sessions, logger }) {

		const rSessionMetaData = await sessions.start('r');

		await app.workbench.console.pasteCodeToConsole('reticulate::py_require("ipykernel")', true);
		await app.workbench.console.pasteCodeToConsole('reticulate::py_run_string("import ipykernel; print(ipykernel.__version__)")', true);

		await app.workbench.console.pasteCodeToConsole('reticulate::repl_python()', true);

		await app.workbench.console.waitForReadyAndStarted('>>>');

		await app.workbench.sessions.rename('reticulate', 'sessionOne');

		await verifyReticulateFunctionality(app, rSessionMetaData.id, 'sessionOne');

		const rSessionMetaData2 = await sessions.start('r', { reuse: false });

		await app.workbench.console.pasteCodeToConsole('reticulate::repl_python()', true);

		await app.workbench.console.waitForReadyAndStarted('>>>');

		await app.workbench.sessions.rename('reticulate', 'sessionTwo');

		await verifyReticulateFunctionality(app, rSessionMetaData2.id, 'sessionTwo', '300', '500', '7');

	});
});
