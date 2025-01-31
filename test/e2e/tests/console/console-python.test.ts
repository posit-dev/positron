/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { test, expect, tags } from '../_test.setup';
import { InterpreterType } from '../../infra';

test.use({
	suiteId: __filename
});

test.describe('Console Pane: Python', { tag: [tags.WEB, tags.CONSOLE] }, () => {

	test('Verify restart button inside the console', {
		tag: [tags.WIN]
	}, async function ({ app, python }) {
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
			await app.workbench.console.barClearButton.click();

			// workaround issue where power button click fails
			await app.code.wait(1000);
			await app.workbench.console.barPowerButton.click();
			await app.workbench.console.consoleRestartButton.click();

			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
			await app.workbench.console.waitForReadyAndRestarted('>>>');
			await expect(app.workbench.console.consoleRestartButton).not.toBeVisible();
		}).toPass();
	});

	test('Verify restart button on console bar', {
		tag: [tags.WIN]
	}, async function ({ app, python }) {
		// Need to make console bigger to see all bar buttons
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.console.barClearButton.click();

		// workaround issue where "started" text never appears post restart
		await app.code.wait(1000);
		await app.workbench.console.barRestartButton.click();

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.console.waitForReadyAndStarted('>>>');
	});

	test('Verify cancel button on console bar', {
		tag: [tags.WIN]
	}, async function ({ app, python }) {

		await app.workbench.console.pasteCodeToConsole('import time; time.sleep(10)');
		await app.workbench.console.sendEnterKey();

		await app.workbench.console.interruptExecution();

	});

	// not enabled for WIN yet; need to add additional versions
	test('Verify multiple versions', async function ({ app, python }) {

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

		const primaryPython = process.env.POSITRON_PY_VER_SEL;

		if (primaryPython) {

			await app.workbench.console.barClearButton.click();

			await app.workbench.console.pasteCodeToConsole('import platform; print(platform.python_version())', true);

			await app.workbench.console.waitForConsoleContents(primaryPython);
		} else {
			fail('Primary Python version not set');
		}

		const secondaryPython = process.env.POSITRON_PY_ALT_VER_SEL;

		if (secondaryPython) {

			await app.workbench.interpreter.selectInterpreter(InterpreterType.Python, `${secondaryPython} (Pyenv)`, true);

			await app.workbench.console.barClearButton.click();

			await app.workbench.console.pasteCodeToConsole(`import platform; print(platform.python_version())`, true);
			await app.workbench.console.waitForConsoleContents(secondaryPython);
		} else {
			fail('Secondary Python version not set');
		}
	});
});
