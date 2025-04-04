/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { test, expect, tags } from '../_test.setup';
import { InterpreterType } from '../../infra/fixtures/interpreter';

test.use({
	suiteId: __filename
});

test.describe('Console Pane: R', {
	tag: [tags.WEB, tags.CONSOLE]
}, () => {
	test.beforeAll(async function ({ app }) {
		// Need to make console bigger to see all bar buttons
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});

	test('R - Verify restart button inside the console', {
		tag: [tags.WIN]
	}, async function ({ app, r }) {
		await expect(async () => {
			await app.workbench.console.barClearButton.click();
			await app.workbench.console.barPowerButton.click();
			await app.workbench.console.consoleRestartButton.click();
			await app.workbench.console.waitForReadyAndRestarted('>');
			await expect(app.workbench.console.consoleRestartButton).not.toBeVisible();
		}).toPass();
	});

	test('R - Verify restart button on console bar', {
		tag: [tags.WIN]
	}, async function ({ app, r }) {
		await expect(async () => {
			await app.workbench.console.barClearButton.click();
			await app.workbench.console.barRestartButton.click();
			await app.workbench.console.waitForReady('>');
			// await app.workbench.console.waitForConsoleContents('cat from .Rprofile'); // add back when Davis gives the go ahead
		}).toPass();
	});

	test('R - Verify cancel button on console bar', {
		tag: [tags.WIN]
	}, async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('Sys.sleep(10)');
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.interruptExecution();
		// nothing appears in console after interrupting execution
	});

	test('R - Verify can use multiple interpreter versions', {
		tag: [tags.WIN]
	}, async function ({ app, r }) {

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

		const primaryR = process.env.POSITRON_R_VER_SEL;

		if (primaryR) {
			await app.workbench.console.barClearButton.click();
			await app.workbench.console.pasteCodeToConsole('R.version.string', true);
			await app.workbench.console.waitForConsoleContents(primaryR);
		} else {
			fail('Primary R version not set');
		}

		const secondaryR = process.env.POSITRON_R_ALT_VER_SEL;

		if (secondaryR) {
			await app.workbench.interpreter.selectInterpreter(InterpreterType.R, secondaryR, true);
			await app.workbench.console.barClearButton.click();
			await app.workbench.console.pasteCodeToConsole(`R.version.string`, true);
			await app.workbench.console.waitForConsoleContents(secondaryR);
		} else {
			fail('Secondary R version not set');
		}
	});


	test('R - Verify password prompt', {
		tag: [tags.WIN]
	}, async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('out <- rstudioapi::askForPassword("enter password")');
		await app.workbench.console.sendEnterKey();

		await app.workbench.quickInput.type('password');
		await app.code.driver.page.keyboard.press('Enter');

		await app.workbench.layouts.enterLayout('stacked');
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');

		await expect(async () => {
			const variablesMap = await app.workbench.variables.getFlatVariables();
			expect(variablesMap.get('out')?.value).toBe('"password"');
		}).toPass({ timeout: 20000 });

		await app.workbench.layouts.enterLayout('stacked');
	});
});

