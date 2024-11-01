/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Input', {
	tag: ['@web', '@pr', '@win']
}, () => {

	test.describe('Console Input - Python', () => {
		test.beforeEach(async function ({ app, interpreter }) {
			await interpreter.set('Python');
			await app.workbench.positronLayouts.enterLayout('fullSizedPanel');
		});

		test('Python - Get Input String Console [C667516]', async function ({ app, interpreter }) {
			await interpreter.set('Python');
			const inputCode = `val = input("Enter your name: ")
print(f'Hello {val}!')`;

			await expect(async () => {
				await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Enter your name:')));

				// slight wait before starting to type
				await app.code.wait(200);

				await app.workbench.positronConsole.typeToConsole('John Doe');
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Hello John Doe!')));
			}).toPass({ timeout: 60000 });
		});
	});

	test.describe('Console Input - R', () => {
		test.beforeEach(async function ({ app, interpreter }) {
			await interpreter.set('R');
			await app.workbench.positronLayouts.enterLayout('fullSizedPanel');
		});

		test('R - Get Input String Console [C667517]', async function ({ app }) {
			const inputCode = `val <- readline(prompt = "Enter your name: ")
cat(sprintf('Hello %s!\n', val))`;

			await expect(async () => {
				await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Enter your name:')));

				// slight wait before starting to type
				await app.code.wait(200);
				await app.workbench.positronConsole.typeToConsole('John Doe');
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Hello John Doe!')));
			}).toPass({ timeout: 60000 });

		});

		test('R - Can use `menu` to select alternatives [C684749]', async function ({ app }) {
			const inputCode = `x <- menu(letters)`;

			await expect(async () => {
				await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Selection:')));

				// slight wait before starting to type
				await app.code.wait(200);
				await app.workbench.positronConsole.typeToConsole('1');
				await app.workbench.positronConsole.sendEnterKey();

				// slight wait before starting to type
				await app.code.wait(200);
				await app.workbench.positronConsole.typeToConsole('x');
				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('[1] 1')));
			}).toPass({ timeout: 60000 });
		});

		test("R - Esc only dismisses autocomplete not full text typed into console [C685868]", async function ({ app }) {
			// This is a regression test for https://github.com/posit-dev/positron/issues/1161

			const inputCode = `base::mea`;

			await expect(async () => {
				await app.workbench.positronConsole.typeToConsole(inputCode);
			}).toPass({ timeout: 60000 });

			const activeConsole = app.workbench.positronConsole.activeConsole;

			// Makes sure the code suggestions are activated
			const suggestion = activeConsole.locator('.suggest-widget');
			await expect(suggestion).toBeVisible();

			// We now send `Esc` to dismiss the suggestion
			await app.workbench.positronConsole.sendKeyboardKey('Escape');
			await expect(suggestion).toBeHidden();

			const inputLocator = activeConsole.locator(".console-input");

			// Send the next `Esc`, that shoukldn't cleanup the typed text
			await app.workbench.positronConsole.sendKeyboardKey('Escape');
			await expect(inputLocator).toContainText('base::mea');

			// We can clear the console text with Ctrl + C
			await app.workbench.positronConsole.sendKeyboardKey('Control+C');
			await expect(inputLocator).not.toContainText("base::mea");
		});
	});
});
