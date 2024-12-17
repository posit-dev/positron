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
		await app.workbench.positronLayouts.enterLayout('fullSizedPanel');
	});


	test('Python - Get Input String Console [C667516]', async function ({ app, python }) {
		const inputCode = `val = input("Enter your name: ")
print(f'Hello {val}!')`;

		await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
		await app.workbench.positronConsole.sendEnterKey();
		await expect(app.workbench.positronConsole.activeConsole.getByText('Enter your name:', { exact: true })).toBeVisible();

		await app.workbench.positronConsole.typeToConsole('John Doe');
		await app.workbench.positronConsole.sendEnterKey();
		await app.workbench.positronConsole.waitForConsoleContents('Hello John Doe!');

	});


	test('R - Get Input String Console [C667517]', async function ({ app, r }) {
		const inputCode = `val <- readline(prompt = "Enter your name: ")
cat(sprintf('Hello %s!\n', val))`;
		await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
		await app.workbench.positronConsole.sendEnterKey();
		await expect(app.workbench.positronConsole.activeConsole.getByText('Enter your name:', { exact: true })).toBeVisible();

		// slight wait before starting to type
		await app.code.wait(200);
		await app.workbench.positronConsole.typeToConsole('John Doe');
		await app.workbench.positronConsole.sendEnterKey();
		await app.workbench.positronConsole.waitForConsoleContents('Hello John Doe!');
	});

	test('R - Can use `menu` to select alternatives [C684749]', async function ({ app, r }) {
		const inputCode = `x <- menu(letters)`;

		await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
		await app.workbench.positronConsole.sendEnterKey();
		await app.workbench.positronConsole.waitForConsoleContents('Selection:');

		await app.workbench.positronConsole.typeToConsole('1');
		await app.workbench.positronConsole.sendEnterKey();

		await app.workbench.positronConsole.typeToConsole('x');
		await app.workbench.positronConsole.sendEnterKey();

		await app.workbench.positronConsole.waitForConsoleContents('[1] 1');
	});

	test("R - Esc only dismisses autocomplete not full text typed into console [C685868]", async function ({ app, page, r }) {
		// This is a regression test for https://github.com/posit-dev/positron/issues/1161

		const inputCode = `base::mea`;

		await app.workbench.positronConsole.typeToConsole(inputCode);

		const activeConsole = app.workbench.positronConsole.activeConsole;

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

