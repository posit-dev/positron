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

	test.beforeEach(async function ({ app, r }) {
		await app.workbench.layouts.enterLayout('fullSizedPanel');
	});


	test('Python - Get Input String Console', async function ({ app, python }) {
		const inputCode = `val = input("Enter your name: "); print(f'Hello {val}!');`;

		await app.workbench.console.pasteCodeToConsole(inputCode);
		await app.workbench.console.sendEnterKey();
		await expect(app.workbench.console.activeConsole.getByText('Enter your name:', { exact: true })).toBeVisible();

		await app.workbench.console.typeToConsole('John Doe');
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.waitForConsoleContents('Hello John Doe!');

	});


	test('R - Get Input String Console', async function ({ app, r }) {
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

	test('R - Can use `menu` to select alternatives', async function ({ app, r }) {
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

	test("R - Esc only dismisses autocomplete not full text typed into console", async function ({ app, page, r }) {
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
});

