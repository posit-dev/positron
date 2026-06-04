/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console History', {
	tag: [tags.WEB, tags.WIN, tags.CONSOLE]
}, () => {
	test.afterEach(async function ({ page }) {
		page.keyboard.press('Escape');
	});

	test('Python - Verify first history and full history', async function ({ app, page, python }) {
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


	test('R - Verify first history and full history', {
		tag: [tags.ARK]
	}, async function ({ app, page, r }) {
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

	test('Python - Shift+Down extends selection instead of navigating history', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/13419' }]
	}, async function ({ app, page, python }) {
		// Build up history so the buggy navigateHistoryDown path would have entries to navigate to.
		await enterLines(app, ['x = 1', 'y = 2']);

		// Type a line but do not submit.
		await app.workbench.console.typeToConsole('abcDEF');
		await app.workbench.console.waitForCurrentConsoleLineContents('abcDEF');

		// Place cursor between "abc" and "DEF".
		await page.keyboard.press('Home');
		for (let i = 0; i < 3; i++) {
			await page.keyboard.press('ArrowRight');
		}

		// Shift+Down should extend selection to end of line, not navigate history.
		await page.keyboard.press('Shift+ArrowDown');

		// Type 'X' to replace whatever is selected.
		// With the fix: 'DEF' is selected and replaced -> line becomes 'abcX'.
		// Without the fix: no selection; 'X' inserts at the cursor -> line becomes 'abcXDEF'.
		await page.keyboard.type('X');

		const viewLine = app.workbench.console.activeConsole.locator('.view-line');
		await expect(viewLine).toContainText('abcX');
		await expect(viewLine).not.toContainText('DEF');

		await app.workbench.console.clearInput();
	});

	test('Python - Cmd+Up engages prefix-match history browser', async function ({ app, page, python }) {
		// Build up history with two different prefixes.
		await enterLines(app, ['apple_count = 1', 'apple_size = 2', 'banana = 3']);

		// Type the prefix to match against; do not submit.
		await app.workbench.console.typeToConsole('apple');

		// Cmd+Up (Ctrl+Up on Windows/Linux) engages the prefix-match history browser.
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+ArrowUp');

		// Browser should show entries matching the typed prefix.
		await app.workbench.console.waitForHistoryContents('apple_count = 1');
		await app.workbench.console.waitForHistoryContents('apple_size = 2');

		// Non-matching entries should be absent.
		await app.workbench.console.waitForHistoryContents('banana', 0);

		// Dismiss the browser and clean up.
		await page.keyboard.press('Escape');
		await app.workbench.console.clearInput();
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
		await app.workbench.console.clearButton.click();
	});
}

async function selectFirstHistoryResult(app: Application, expectedLine: string) {
	await test.step('Select first history result', async () => {
		const page = app.code.driver.currentPage;
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
		await app.workbench.console.clearButton.click();

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.code.driver.currentPage.keyboard.press('Control+R');

		await app.workbench.console.waitForHistoryContents(lines[0], 2);
		await app.workbench.console.waitForHistoryContents(lines[1]);
		await app.workbench.console.waitForHistoryContents(lines[2]);
	});
}
