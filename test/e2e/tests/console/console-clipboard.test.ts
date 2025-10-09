/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { test, tags } from '../_test.setup';
import { Application, Console } from '../../infra';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Console - Clipboard', { tag: [tags.CONSOLE, tags.WIN, tags.WEB] }, () => {
	test('Python - Verify copy from console & paste to console', async ({ app, python, page }) => {
		await testConsoleClipboard(app, 'a = 1', (new URL(page.url())).port);
	});

	test('Python - Verify copy from console & paste to console with context menu',
		{ tag: [tags.WEB_ONLY] },
		async ({ app, python, page }) => {
			await testConsoleClipboardWithContextMenu(app, '>>>', /Python .+ restarted\./, (new URL(page.url())).port);
		});

	test('R - Verify copy from console & paste to console ', {
		tag: [tags.ARK]
	}, async ({ app, r, page }) => {
		await testConsoleClipboard(app, 'a <- 1', (new URL(page.url())).port);
	});

	test('R - Verify copy from console & paste to console with context menu',
		{ tag: [tags.WEB_ONLY, tags.ARK] },
		async ({ app, r, page }) => {
			await testConsoleClipboardWithContextMenu(app, '>', /R .+ restarted\./, (new URL(page.url())).port);
		});
});

async function testConsoleClipboard(app: Application, testLine: string, port: string) {

	if (app.web) {
		await app.code.driver.context.grantPermissions(['clipboard-read'], { origin: `http://localhost:${port}` });
	}

	const console = app.workbench.console;
	const page = console.activeConsole.page();

	await toggleAuxiliaryBar(app);
	await initializeConsole(console);
	await executeCopyAndPaste(console, page, testLine);
	await verifyClipboardPaste(console, testLine);
	await toggleAuxiliaryBar(app);
}

async function testConsoleClipboardWithContextMenu(app: Application, prompt: string, regex: RegExp, port: string) {

	await app.workbench.console.clearButton.click();
	await app.workbench.console.restartButton.click();

	await app.workbench.console.waitForReady(prompt);

	if (app.web) {

		await app.code.driver.context.grantPermissions(['clipboard-read'], { origin: `http://localhost:${port}` });
	}

	await expect(async () => {
		await app.workbench.terminal.handleContextMenu(app.workbench.console.activeConsole, 'Select All');

		// wait a little between selection and copy
		await app.code.wait(1000);

		await app.workbench.terminal.handleContextMenu(app.workbench.console.activeConsole, 'Copy');

		const clipboardText = await app.workbench.clipboard.getClipboardText();

		expect(clipboardText).toMatch(regex);
	}).toPass({ timeout: 60000 });

}

async function toggleAuxiliaryBar(app: Application) {
	await test.step('Toggle auxiliary bar', async () => {
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});
}

async function initializeConsole(console: Console) {
	await test.step('Initialize console', async () => {
		await console.sendEnterKey();
		await console.clearButton.click();
	});
}

async function executeCopyAndPaste(console: Console, page: any, testLine: string) {

	const isMac = os.platform() === 'darwin';
	const modifier = isMac ? 'Meta' : 'Control';

	await test.step('Copy and paste', async () => {
		// Type the test line into the console
		await console.typeToConsole(testLine);

		// Copy the test line
		await page.keyboard.press(`${modifier}+A`);
		await page.keyboard.press(`${modifier}+C`);
		await console.sendEnterKey();
		await console.waitForConsoleExecution();

		// Ensure the test line is in the console's output
		await console.waitForConsoleContents(testLine);

		// Clear the console
		await console.clearButton.click();

		// Paste the copied line into the console
		await page.keyboard.press(`${modifier}+V`);
	});
}

async function verifyClipboardPaste(console: any, testLine: string) {
	await test.step('Verify clipboard paste ', async () => {
		// Verify the pasted line in the current input
		await console.waitForCurrentConsoleLineContents(testLine.replaceAll(' ', ' '));
		await console.sendEnterKey();
		await console.waitForConsoleExecution();

		// Ensure the console contains the test line after execution
		await console.waitForConsoleContents(testLine);
	});
}
