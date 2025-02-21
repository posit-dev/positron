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

// Re-add WEB tag when https://github.com/posit-dev/positron/issues/6397 is fixed
test.describe('Reticulate', {
	tag: [tags.RETICULATE, tags.WEB],
	annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6397' }]
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

	// if running tests in sequence, we will need to skip waiting for ready because interpreters
	// will already be running
	let sequential = false;

	test('R - Verify Basic Reticulate Functionality', async function ({ app, r, interpreter }) {

		await app.workbench.console.pasteCodeToConsole('reticulate::repl_python()');
		await app.workbench.console.sendEnterKey();

		try {
			await app.workbench.console.waitForConsoleContents('Yes/no/cancel');
			await app.workbench.console.typeToConsole('no');
			await app.workbench.console.sendEnterKey();
		} catch {
			// Prompt did not appear
		}

		await app.workbench.popups.installIPyKernel();

		await app.workbench.console.waitForReadyAndStarted('>>>');

		await verifyReticulateFunctionality(app, interpreter, false);

		sequential = true;

	});

	test('R - Verify Reticulate Stop/Restart Functionality', {
		tag: [tags.WEB_ONLY]
	}, async function ({ app, interpreter }) {

		await app.workbench.interpreter.selectInterpreter('Python', 'Python (reticulate)', false);

		await app.workbench.popups.installIPyKernel();

		if (!sequential) {
			app.workbench.console.waitForReadyAndStarted('>>>', 30000);
		}

		await verifyReticulateFunctionality(app, interpreter, sequential);

		await app.workbench.layouts.enterLayout('stacked');

		await app.workbench.console.barPowerButton.click();

		await app.workbench.console.waitForConsoleContents('shut down successfully');

		await app.code.driver.page.locator('.positron-console').getByRole('button', { name: 'Restart R' }).click();

		await app.workbench.console.waitForReadyAndStarted('>');

		await app.code.driver.page.locator('.positron-console').locator('.action-bar-button-drop-down-arrow').click();

		await app.code.driver.page.locator('.action-label', { hasText: 'Python (reticulate)' }).hover();

		await app.code.driver.page.keyboard.press('Enter');

		await app.code.driver.page.locator('.positron-console').getByRole('button', { name: 'Restart Python' }).click();

		await app.workbench.console.waitForReadyAndStarted('>>>');

		await verifyReticulateFunctionality(app, interpreter, sequential);

	});
});

async function verifyReticulateFunctionality(app, interpreter, sequential) {

	await app.workbench.console.pasteCodeToConsole('x=100');
	await app.workbench.console.sendEnterKey();

	await app.workbench.console.barClearButton.click();

	await interpreter.set('R', !sequential);

	await app.workbench.console.pasteCodeToConsole('y<-reticulate::py$x');
	await app.workbench.console.sendEnterKey();

	await app.workbench.console.barClearButton.click();

	await app.workbench.layouts.enterLayout('fullSizedAuxBar');

	await expect(async () => {
		const variablesMap = await app.workbench.variables.getFlatVariables();
		expect(variablesMap.get('y')).toStrictEqual({ value: '100', type: 'int' });
	}).toPass({ timeout: 60000 });

	await app.workbench.layouts.enterLayout('stacked');
}
