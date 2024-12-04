/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { test, expect } from '../../_test.setup';
import { Application } from '../../../automation';

test.use({
	suiteId: __filename
});

test.describe('Console - Clipboard', () => {
	test('Python - Copy from console & paste to console [C608100]', async function ({ app, python }) {
		await testBody(app);
	});

	test('R - Copy from console & paste to console [C663725]', async function ({ app, r }) {
		await testBody(app);
	});
});

async function testBody(app: Application) {
	const isMac = os.platform() === 'darwin';
	const modifier = isMac ? 'Meta' : 'Control';

	await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

	const activeConsole = app.workbench.positronConsole.activeConsole;
	await activeConsole.click();
	const page = activeConsole!.page();

	const testLine = 'a = 1';

	await expect(async () => {
		// Ensure nothing is in the current line and clear the console
		await app.workbench.positronConsole.sendEnterKey();
		await app.workbench.positronConsole.barClearButton.click();

		// Send test line to console
		await app.workbench.positronConsole.typeToConsole(testLine);

		// copy the test line and send enter key
		await page.keyboard.press(`${modifier}+A`);
		await page.keyboard.press(`${modifier}+C`);
		await app.workbench.positronConsole.sendEnterKey();

		// ensure the console previous lines contain the test line
		await app.workbench.positronConsole.waitForConsoleContents(
			(lines) => lines.some((line) => line.includes(testLine)));

		// clear the console and ensure the clear succeeded
		await app.workbench.positronConsole.barClearButton.click();
		await app.workbench.positronConsole.waitForConsoleContents((contents) => {
			return !contents.some(Boolean);
		});
	}).toPass({ timeout: 40000 });

	await page.keyboard.press(`${modifier}+V`);

	await app.workbench.positronConsole.waitForCurrentConsoleLineContents((line) =>
		line.includes(testLine.replaceAll(' ', ' ')));

	await app.workbench.positronConsole.sendEnterKey();

	// check for two instances of the test line in a row (invalid)
	await app.workbench.positronConsole.waitForConsoleContents((contents) =>
		contents.some((line) => line.includes(testLine))
	);

	await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
}
