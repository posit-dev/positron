/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra/index.js';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// In order to run this test on Windows, I think we need to set the env var:
// RETICULATE_PYTHON
// to the installed python path

test.describe.skip('Reticulate', {
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

	// if running tests in sequence, we will need to skip waiting for ready because interpreters
	// will already be running
	let sequential = false;

	test('R - Verify Basic Reticulate Functionality', async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('reticulate::repl_python()', true);
		await app.code.driver.page.pause();

		try {
			await app.workbench.console.waitForConsoleContents('Yes/no/cancel');
			await app.workbench.console.typeToConsole('no');
			await app.workbench.console.sendEnterKey();
		} catch {
			// Prompt did not appear
		}

		await app.workbench.popups.installIPyKernel();

		await app.workbench.console.waitForReadyAndStarted('>>>');

		await verifyReticulateFunctionality(app, false);

		sequential = true;

	});

	test('R - Verify Reticulate Stop/Restart Functionality', {
		tag: [tags.WEB_ONLY]
	}, async function ({ app, sessions }) {

		await sessions.startAndSkipMetadata({ language: 'Python', waitForReady: false });
		await sessions.expectSessionPickerToBe('Python (reticulate)');

		await app.workbench.popups.installIPyKernel();

		if (!sequential) {
			app.workbench.console.waitForReadyAndStarted('>>>', 30000);
		}

		await verifyReticulateFunctionality(app, sequential);

		await app.workbench.layouts.enterLayout('stacked');

		await app.workbench.console.trashButton.click();

		await app.workbench.console.waitForConsoleContents('shut down successfully');

		await app.code.driver.page.locator('.positron-console').getByRole('button', { name: 'Restart R' }).click();

		await app.workbench.console.waitForReadyAndStarted('>');

		await app.code.driver.page.locator('.positron-console').locator('.action-bar-button-drop-down-arrow').click();

		await app.code.driver.page.locator('.action-label', { hasText: 'Python (reticulate)' }).hover();

		await app.code.driver.page.keyboard.press('Enter');

		await app.code.driver.page.locator('.positron-console').getByRole('button', { name: 'Restart Python' }).click();

		await app.workbench.console.waitForReadyAndStarted('>>>');

		await verifyReticulateFunctionality(app, sequential);

	});

	test.skip('R - Verify Reticulate Restart', {
		tag: [tags.RETICULATE, tags.CONSOLE]
	}, async function ({ app, sessions }) {
		// const interpreterDesc = 'Python (reticulate)';
		// if (!sequential) {
		// await app.workbench.interpreter.selectInterpreter('Python', interpreterDesc, true);
		// }
		// await app.workbench.interpreter.verifyInterpreterIsRunning(interpreterDesc);

		// await app.workbench.interpreter.restartPrimaryInterpreter(interpreterDesc);
		// await app.workbench.interpreter.verifyInterpreterIsRunning(interpreterDesc);
	});
});

test.describe('Reticulate - console interaction', {
	tag: [tags.RETICULATE, tags.WEB]
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

	test.skip('R - Reticulate can be started with reticulate::repl_python()', async function ({ app, sessions }) {
		// // Start R console
		// await app.workbench.interpreter.selectInterpreter(InterpreterType.R, process.env.POSITRON_R_VER_SEL!);

		// // Now execute reticulate::repl_python()
		// await app.workbench.console.pasteCodeToConsole('reticulate::repl_python()');
		// await app.workbench.console.sendEnterKey();

		// // Wait for the reticulate interpreter to be running
		// // There's a small bug such that the button is green button is updated when
		// // the session starts. So we need to wait until reticulate starts to see the
		// // interpreter running
		// await app.workbench.console.waitForReadyAndStarted('>>>', 30000);
		// await app.workbench.interpreter.verifyInterpreterIsRunning('Python (reticulate)');

		// // Create a variable in Python, we'll check we can access it from R.
		// await app.workbench.console.pasteCodeToConsole('x=100');
		// await app.workbench.console.sendEnterKey();

		// // Now go back to the R interprerter
		// await app.workbench.interpreter.selectInterpreter(InterpreterType.R, process.env.POSITRON_R_VER_SEL!);
		// await app.workbench.console.pasteCodeToConsole('print(reticulate::py$x)');
		// await app.workbench.console.sendEnterKey();
		// await app.workbench.console.waitForConsoleContents('[1] 100');

		// // Create a variable in R and expect to be able to access it from Python
		// await app.workbench.console.pasteCodeToConsole('y <- 200L');
		// await app.workbench.console.sendEnterKey();

		// // Executing reticulate::repl_python() should not start a new interpreter
		// // but should move focus to the reticulate interpreter
		// await app.workbench.console.pasteCodeToConsole('reticulate::repl_python(input = "z = 3")');
		// await app.workbench.console.sendEnterKey();

		// // Expect that focus changed to the reticulate console
		// await app.workbench.interpreter.verifyInterpreterIsRunning('Python (reticulate)');
		// await app.workbench.console.pasteCodeToConsole('print(r.y)');
		// await app.workbench.console.sendEnterKey();
		// await app.workbench.console.waitForConsoleContents('200');

		// await app.workbench.console.pasteCodeToConsole('print(z)');
		// await app.workbench.console.sendEnterKey();
		// await app.workbench.console.waitForConsoleContents('200');
	});
});

async function verifyReticulateFunctionality(app: Application, sequential) {

	await app.workbench.console.pasteCodeToConsole('x=100');
	await app.workbench.console.sendEnterKey();

	await app.workbench.console.clearButton.click();

	await app.workbench.sessions.startAndSkipMetadata({ language: 'R', waitForReady: !sequential });

	await app.workbench.console.pasteCodeToConsole('y<-reticulate::py$x');
	await app.workbench.console.sendEnterKey();

	await app.workbench.console.clearButton.click();

	await app.workbench.layouts.enterLayout('fullSizedAuxBar');

	await expect(async () => {
		const variablesMap = await app.workbench.variables.getFlatVariables();
		expect(variablesMap.get('y')).toStrictEqual({ value: '100', type: 'int' });
	}).toPass({ timeout: 10000 });

	await app.workbench.layouts.enterLayout('stacked');
}
