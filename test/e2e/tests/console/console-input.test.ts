/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Input', {
	tag: [tags.WEB, tags.CRITICAL, tags.WIN, tags.CONSOLE]
}, () => {

	test.beforeEach(async function ({ app }) {
		await app.workbench.layouts.enterLayout('fullSizedPanel');
	});


	test('Python - Can get input string via console', async function ({ app, python }) {
		const inputCode = `val = input("Enter your name: "); print(f'Hello {val}!');`;

		await app.workbench.console.pasteCodeToConsole(inputCode);
		await app.workbench.console.sendEnterKey();
		await expect(app.workbench.console.activeConsole.getByText('Enter your name:', { exact: true })).toBeVisible();

		await app.workbench.console.typeToConsole('John Doe');
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.waitForConsoleContents('Hello John Doe!');

	});


	test('R - Can get input string via console', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		const inputCode = `val <- readline(prompt = "Enter your name: ")
cat(sprintf('Hello %s!\n', val))`;
		await app.workbench.console.pasteCodeToConsole(inputCode);
		await app.workbench.console.sendEnterKey();
		await expect(app.workbench.console.activeConsole.getByText('Enter your name:', { exact: true })).toBeVisible();

		// slight wait before starting to type
		await app.code.wait(200);
		await app.workbench.console.typeToConsole('John Doe');
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.waitForConsoleContents('Hello John Doe!');
	});

	test('R - Can use `menu` to select alternatives', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		const inputCode = `x <- menu(letters)`;

		await app.workbench.console.pasteCodeToConsole(inputCode);
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.waitForConsoleContents('Selection:');

		await app.workbench.console.typeToConsole('1');
		await app.workbench.console.sendEnterKey();

		await app.workbench.console.typeToConsole('x');
		await app.workbench.console.sendEnterKey();

		await app.workbench.console.waitForConsoleContents('[1] 1');
	});

	test("R - Verify ESC dismisses autocomplete without deleting typed text", {
		tag: [tags.ARK]
	}, async function ({ app, page, r }) {
		// This is a regression test for https://github.com/posit-dev/positron/issues/1161

		const inputCode = `base::mea`;

		await app.workbench.console.typeToConsole(inputCode);

		const activeConsole = app.workbench.console.activeConsole;

		// Makes sure the code suggestions are activated
		const suggestion = activeConsole.locator('.suggest-widget');
		await expect(suggestion).toBeVisible();

		// We now send `Esc` to dismiss the suggestion
		await page.keyboard.press('Escape');
		await expect(suggestion).toBeHidden();

		const inputLocator = activeConsole.locator(".console-input");

		// Send the next `Esc`, that shouldn't cleanup the typed text
		await page.keyboard.press('Escape');
		await expect(inputLocator).toContainText('base::mea');

		// We can clear the console text with Ctrl + C
		await page.keyboard.press('Control+C');
		await expect(inputLocator).not.toContainText("base::mea");
	});

	test('Python - Home / End / Ctrl+U act on the console input, not the output scroll', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/7380' }]
	}, async function ({ app, page, python }) {
		// Regression test for the keybinding migration. Home / End must move the
		// cursor to the start / end of the input line (cursorLineStart /
		// cursorLineEnd) rather than scrolling the console output to top / bottom,
		// and Ctrl+U must delete from the cursor to the start of the line. The
		// console output container has its own Home / End scroll handler, so this
		// guards the carve-out that lets input-originated keys reach the editor.
		const activeConsole = app.workbench.console.activeConsole;
		const inputLocator = activeConsole.locator('.console-input');

		await app.workbench.console.typeToConsole('abcDEF');
		await app.workbench.console.waitForCurrentConsoleLineContents('abcDEF');

		// Dismiss any autocomplete popup so it does not capture the keys.
		await page.keyboard.press('Escape');

		// Home moves the cursor to the start: typing inserts before 'abc'.
		await page.keyboard.press('Home');
		await page.keyboard.type('1');
		await expect(inputLocator).toContainText('1abcDEF');
		await expect(inputLocator).not.toContainText('abcDEF1');

		// End moves the cursor to the end: typing appends.
		await page.keyboard.press('End');
		await page.keyboard.type('2');
		await expect(inputLocator).toContainText('1abcDEF2');

		// Ctrl+U deletes from the cursor (end of line) to the start of the line.
		await page.keyboard.press('Control+U');
		await expect(inputLocator).not.toContainText('abcDEF');

		await app.workbench.console.clearInput();
	});
});

