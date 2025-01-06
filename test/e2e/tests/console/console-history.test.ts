/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../automation';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console History', {
	tag: [tags.WEB, tags.WIN, tags.CONSOLE]
}, () => {
	test.afterEach(async function ({ page }) {
		page.keyboard.press('Escape');
	});

	test('Python - Verify Console History [C685945]', async function ({ app, page, python }) {
		const pythonLines = [
			'a = 1',
			'b = 2',
			'c = 3'
		];

		await enterLines(app, pythonLines);
		await clearConsole(app);
		await selectFirstHistoryResult(app, pythonLines[0]);
		await verifyFullHistory(app, pythonLines);
		await clearConsole(app);
	});


	test('R - Verify Console History [C685946]]', async function ({ app, page, r }) {
		const rLines = [
			'a <- 1',
			'b <- 2',
			'c <- 3'
		];

		await enterLines(app, rLines);
		await clearConsole(app);
		await selectFirstHistoryResult(app, rLines[0]);
		await verifyFullHistory(app, rLines);
		await clearConsole(app);
	});
});

async function enterLines(app: Application, lines: string[]) {
	await test.step('Enter lines into the console', async () => {
		for (const line of lines) {
			await app.workbench.console.typeToConsole(line);
			await app.workbench.console.sendEnterKey();
			await app.workbench.console.waitForConsoleContents(line);
		}
	});
}


async function clearConsole(app: Application) {
	await test.step('Clear the console', async () => {
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.workbench.console.barClearButton.click();
	});
}

async function selectFirstHistoryResult(app: Application, expectedLine: string) {
	await test.step('Select first history result', async () => {
		const page = app.code.driver.page;
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		await app.workbench.console.waitForCurrentConsoleLineContents(expectedLine);
		await app.workbench.console.sendEnterKey();
	});
}

async function verifyFullHistory(app: Application, lines: string[]) {
	await test.step('Verify the full history', async () => {
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.console.barClearButton.click();

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.code.driver.page.keyboard.press('Control+R');

		await app.workbench.console.waitForHistoryContents(lines[0], 2);
		await app.workbench.console.waitForHistoryContents(lines[1]);
		await app.workbench.console.waitForHistoryContents(lines[2]);
	});
}
