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
		await app.positron.layouts.enterLayout('fullSizedPanel');
	});


	test('Python - Can get input string via console', async function ({ app, python }) {
		const inputCode = `val = input("Enter your name: "); print(f'Hello {val}!');`;

		await app.positron.console.pasteCodeToConsole(inputCode);
		await app.positron.console.sendEnterKey();
		await expect(app.positron.console.activeConsole.getByText('Enter your name:', { exact: true })).toBeVisible();

		await app.positron.console.typeToConsole('John Doe');
		await app.positron.console.sendEnterKey();
		await app.positron.console.waitForConsoleContents('Hello John Doe!');

	});


	test('R - Can get input string via console', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		const inputCode = `val <- readline(prompt = "Enter your name: ")
cat(sprintf('Hello %s!\n', val))`;
		await app.positron.console.pasteCodeToConsole(inputCode);
		await app.positron.console.sendEnterKey();
		await expect(app.positron.console.activeConsole.getByText('Enter your name:', { exact: true })).toBeVisible();

		// slight wait before starting to type
		await app.code.wait(200);
		await app.positron.console.typeToConsole('John Doe');
		await app.positron.console.sendEnterKey();
		await app.positron.console.waitForConsoleContents('Hello John Doe!');
	});

	test('R - Can use `menu` to select alternatives', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		const inputCode = `x <- menu(letters)`;

		await app.positron.console.pasteCodeToConsole(inputCode);
		await app.positron.console.sendEnterKey();
		await app.positron.console.waitForConsoleContents('Selection:');

		await app.positron.console.typeToConsole('1');
		await app.positron.console.sendEnterKey();

		await app.positron.console.typeToConsole('x');
		await app.positron.console.sendEnterKey();

		await app.positron.console.waitForConsoleContents('[1] 1');
	});

	test("R - Verify ESC dismisses autocomplete without deleting typed text", {
		tag: [tags.ARK]
	}, async function ({ app, page, r }) {
		// This is a regression test for https://github.com/posit-dev/positron/issues/1161

		const inputCode = `base::mea`;

		await app.positron.console.typeToConsole(inputCode);

		const activeConsole = app.positron.console.activeConsole;

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
});

