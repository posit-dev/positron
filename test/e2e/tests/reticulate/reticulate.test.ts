/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InterpreterType } from '../../infra/fixtures/interpreter.js';
import { test, expect, tags } from '../_test.setup';

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

	test('R - Verify Reticulate Restart', {
		tag: [tags.RETICULATE, tags.CONSOLE]
	}, async function ({ app, interpreter }) {
		const interpreterDesc = 'Python (reticulate)';
		if (!sequential) {
			await app.workbench.interpreter.selectInterpreter('Python', interpreterDesc, true);
		}
		await app.workbench.interpreter.verifyInterpreterIsRunning(interpreterDesc);

		await app.workbench.interpreter.restartPrimaryInterpreter(interpreterDesc);
		await app.workbench.interpreter.verifyInterpreterIsRunning(interpreterDesc);
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

	test('R - Reticulate can be started with reticulate::repl_python()', async function ({ app, interpreter }) {
		// Start R console
		await app.workbench.interpreter.selectInterpreter(InterpreterType.R, process.env.POSITRON_R_VER_SEL!);

		// Now execute reticulate::repl_python()
		await app.workbench.console.pasteCodeToConsole('reticulate::repl_python()');
		await app.workbench.console.sendEnterKey();

		// Wait for the reticulate interpreter to be running
		// There's a small bug such that the button is green button is updated when
		// the session starts. So we need to wait until reticulate starts to see the
		// interpreter running
		await app.workbench.console.waitForReadyAndStarted('>>>', 30000);
		await app.workbench.interpreter.verifyInterpreterIsRunning('Python (reticulate)');

		// Create a variable in Python, we'll check we can access it from R.
		await app.workbench.console.pasteCodeToConsole('x=100');
		await app.workbench.console.sendEnterKey();

		// Now go back to the R interprerter
		await app.workbench.interpreter.selectInterpreter(InterpreterType.R, process.env.POSITRON_R_VER_SEL!);
		await app.workbench.console.pasteCodeToConsole('print(reticulate::py$x)');
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.waitForConsoleContents('[1] 100');

		// Create a variable in R and expect to be able to access it from Python
		await app.workbench.console.pasteCodeToConsole('y <- 200L');
		await app.workbench.console.sendEnterKey();

		// Executing reticulate::repl_python() should not start a new interpreter
		// but should move focus to the reticulate interpreter
		await app.workbench.console.pasteCodeToConsole('reticulate::repl_python(input = "z = 3")');
		await app.workbench.console.sendEnterKey();

		// Expect that focus changed to the reticulate console
		await app.workbench.interpreter.verifyInterpreterIsRunning('Python (reticulate)');
		await app.workbench.console.pasteCodeToConsole('print(r.y)');
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.waitForConsoleContents('200');

		await app.workbench.console.pasteCodeToConsole('print(z)');
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.waitForConsoleContents('200');
	});
});

test.describe('Reticulate - multi console sessions', {
	tag: [tags.RETICULATE, tags.WEB, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([
			['console.multipleConsoleSessions', 'true'],
			['positron.reticulate.enabled', 'true']
		], true);
	});

	test.beforeEach(async function ({ app, sessions }) {
		await app.workbench.variables.togglePane('hide');
		await sessions.deleteDisconnectedSessions();
		await sessions.clearConsoleAllSessions();
	});

	test('Can initialize multiple reticulate sessions', async function ({ app, sessions }) {

		// This should start both an R session and the reticulate session
		const reticulateSession = await sessions.start('pythonReticulate', { waitForReady: true });
		await sessions.expectStatusToBe(reticulateSession.id, 'idle', { timeout: 60000 });
		await sessions.expectSessionCountToBe(2);
		await sessions.expectAllSessionsToBeIdle();


		// Now launch a new reticulate session. This should start another R session
		// and another python session.
		const reticulateSession2 = await sessions.start('pythonReticulate', { waitForReady: true, reuse: false });
		await sessions.expectStatusToBe(reticulateSession2.id, 'idle', { timeout: 60000 });
		await sessions.expectSessionCountToBe(4);
		await sessions.expectAllSessionsToBeIdle();

		const sessionIds = await sessions.getAllSessionIds();
		for (const id of sessionIds) {
			await sessions.select(id);
			let info;
			try {
				info = await sessions.getSelectedSessionInfo();
			} catch (e) {
				// getSelectSessionInfo works by parsing the name of the session
				// but reticulate doesn't follow the same convention, we just skip
				// for reticulate sessions
			}

			if (info && info.language === 'R') {
				const val = Math.floor(Math.random() * 100);
				await app.workbench.console.pasteCodeToConsole(`x <- ${val}L`);
				await app.workbench.console.sendEnterKey();

				await app.workbench.console.pasteCodeToConsole('reticulate::repl_python()');
				await app.workbench.console.sendEnterKey();

				await app.workbench.console.waitForReadyAndStarted('>>>', 30000);

				await app.workbench.console.pasteCodeToConsole('print(r.x)');
				await app.workbench.console.sendEnterKey();

				await app.workbench.console.waitForConsoleContents(`${val}`);
			}
		}

		// Now test restarts
		let restart = sessions.restart(reticulateSession.id, { waitForIdle: false });
		await app.workbench.popups.acceptModalDialog();
		await restart;
		await sessions.expectStatusToBe(reticulateSession.id, 'idle', { timeout: 60000 });

		// The other reticulate session should still print something from `x`
		await sessions.select(reticulateSession2.id);
		await app.workbench.console.pasteCodeToConsole('print(type(r.x))');
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.waitForConsoleContents('int');

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
