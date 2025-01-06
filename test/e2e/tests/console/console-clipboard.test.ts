/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { test, tags } from '../_test.setup';
import { Application, Console } from '../../infra';

test.use({
	suiteId: __filename
});


test.describe('Console - Clipboard', { tag: [tags.CONSOLE, tags.WIN] }, () => {
	test('Python - Copy from console & paste to console [C608100]', async ({ app, python }) => {
		await testConsoleClipboard(app);
	});

	test('R - Copy from console & paste to console [C663725]', async ({ app, r }) => {
		await testConsoleClipboard(app);
	});
});

async function testConsoleClipboard(app: Application) {
	const console = app.workbench.console;
	const page = console.activeConsole.page();
	const testLine = 'a = 1';

	await toggleAuxiliaryBar(app);
	await initializeConsole(console);
	await executeCopyAndPaste(console, page, testLine);
	await verifyClipboardPaste(console, testLine);
	await toggleAuxiliaryBar(app);
}

async function toggleAuxiliaryBar(app: Application) {
	await test.step('Toggle auxiliary bar', async () => {
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});
}

async function initializeConsole(console: any) {
	await test.step('Initialize console', async () => {
		await console.sendEnterKey();
		await console.barClearButton.click();
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
		await console.barClearButton.click();

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
