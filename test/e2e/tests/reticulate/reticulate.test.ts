/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// In order to run this test on Windows, I think we need to set the env var:
// RETICULATE_PYTHON
// to the installed python path

test.describe('Reticulate', {
	tag: [tags.WEB, tags.RETICULATE],
	annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5226' }]
}, () => {
	test.beforeAll(async function ({ app, userSettings }) {
		try {
			// remove this once https://github.com/posit-dev/positron/issues/5226
			// is resolved
			await userSettings.set([
				['positron.reticulate.enabled', 'true']
			]);

		} catch (e) {
			await app.code.driver.takeScreenshot('reticulateSetup');
			throw e;
		}
	});

	test('R - Verify Basic Reticulate Functionality [C...]', async function ({ app, r, interpreter }) {

		await app.workbench.console.pasteCodeToConsole('reticulate::repl_python()');
		await app.workbench.console.sendEnterKey();

		try {
			await app.workbench.console.waitForConsoleContents('Yes/no/cancel');
			await app.workbench.console.typeToConsole('no');
			await app.workbench.console.sendEnterKey();
		} catch {
			// Prompt did not appear
		}

		await app.workbench.console.waitForReady('>>>');
		await app.workbench.console.pasteCodeToConsole('x=100');
		await app.workbench.console.sendEnterKey();

		await interpreter.set('R');

		await app.workbench.console.pasteCodeToConsole('y<-reticulate::py$x');
		await app.workbench.console.sendEnterKey();
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');

		await expect(async () => {
			const variablesMap = await app.workbench.variables.getFlatVariables();
			expect(variablesMap.get('y')).toStrictEqual({ value: '100', type: 'int' });
		}).toPass({ timeout: 60000 });

	});

	test('R - Verify Reticulate Stop/Restart Functionality [C...]', async function ({ app, r, interpreter }) {

		await app.workbench.console.pasteCodeToConsole('reticulate::repl_python()');
		await app.workbench.console.sendEnterKey();

		try {
			await app.workbench.console.waitForConsoleContents('Yes/no/cancel');
			await app.workbench.console.typeToConsole('no');
			await app.workbench.console.sendEnterKey();
		} catch {
			// Prompt did not appear
		}

		await app.workbench.console.waitForReady('>>>');
		await app.workbench.console.pasteCodeToConsole('x=100');
		await app.workbench.console.sendEnterKey();

		await interpreter.set('R');

		await app.workbench.console.pasteCodeToConsole('y<-reticulate::py$x');
		await app.workbench.console.sendEnterKey();
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');

		await expect(async () => {
			const variablesMap = await app.workbench.variables.getFlatVariables();
			expect(variablesMap.get('y')).toStrictEqual({ value: '100', type: 'int' });
		}).toPass({ timeout: 60000 });

	});
});
