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

	test('Python - Verify focus remains in console after input() completion', async function ({ app, page, python }) {
		await test.step('Execute input() and verify focus before typing', async () => {
			const inputCode = `name = input("Enter your name: ")`;
			await app.workbench.console.pasteCodeToConsole(inputCode);
			await app.workbench.console.sendEnterKey();

			// Wait for the prompt to appear
			await expect(app.workbench.console.activeConsole.getByText('Enter your name:', { exact: true })).toBeVisible();
		});

		await test.step('Type input and verify focus after completion', async () => {
			// Type the response
			await app.workbench.console.typeToConsole('Alice');
			await app.workbench.console.sendEnterKey();

			// Wait for the input to be processed
			await page.waitForTimeout(1000);
		});

		await test.step('Verify console is ready for next command', async () => {
			// Verify we can immediately type a new command without clicking
			await app.workbench.console.typeToConsole('print(name)');
			await app.workbench.console.sendEnterKey();
			await app.workbench.console.waitForConsoleContents('Alice');
		});
	});

	test('R - Verify focus remains in console after readline() completion', {
		tag: [tags.ARK]
	}, async function ({ app, page, r }) {
		await test.step('Execute readline() and verify focus before typing', async () => {
			const inputCode = `name <- readline(prompt = "Enter your name: ")`;
			await app.workbench.console.pasteCodeToConsole(inputCode);
			await app.workbench.console.sendEnterKey();

			// Wait for the prompt to appear
			await expect(app.workbench.console.activeConsole.getByText('Enter your name:', { exact: true })).toBeVisible();

			// Slight wait for R's readline to be ready
			await app.code.wait(200);
		});

		await test.step('Type input and verify focus after completion', async () => {
			// Type the response
			await app.workbench.console.typeToConsole('Bob');
			await app.workbench.console.sendEnterKey();

			// Wait for the input to be processed
			await page.waitForTimeout(1000);
		});

		await test.step('Verify console is ready for next command', async () => {
			// Verify we can immediately type a new command without clicking
			await app.workbench.console.typeToConsole('cat(name)');
			await app.workbench.console.sendEnterKey();
			await app.workbench.console.waitForConsoleContents('Bob');
		});
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

	test('Python - Verify focus maintained with multiple consecutive input() calls', async function ({ app, page, python }) {
		await test.step('Execute multiple input() calls', async () => {
			const inputCode = `first = input("First: ")
second = input("Second: ")
print(f"{first} and {second}")`;
			await app.workbench.console.pasteCodeToConsole(inputCode);
			await app.workbench.console.sendEnterKey();

			// First input
			await expect(app.workbench.console.activeConsole.getByText('First:', { exact: true })).toBeVisible();

			await app.workbench.console.typeToConsole('Alpha');
			await app.workbench.console.sendEnterKey();
			await page.waitForTimeout(500);

			// Second input - focus should still be maintained
			await expect(app.workbench.console.activeConsole.getByText('Second:', { exact: true })).toBeVisible();

			await app.workbench.console.typeToConsole('Beta');
			await app.workbench.console.sendEnterKey();

			// After completion, verify output and console readiness
			await page.waitForTimeout(1000);
			await app.workbench.console.waitForConsoleContents('Alpha and Beta');
		});
	});

	test('R - Verify focus maintained with multiple consecutive readline() calls', {
		tag: [tags.ARK]
	}, async function ({ app, page, r }) {
		await test.step('Execute multiple readline() calls', async () => {
			const inputCode = `first <- readline("First: ")
second <- readline("Second: ")
cat(paste(first, "and", second))`;
			await app.workbench.console.pasteCodeToConsole(inputCode);
			await app.workbench.console.sendEnterKey();

			// First input
			await expect(app.workbench.console.activeConsole.getByText('First:', { exact: true })).toBeVisible();
			await app.code.wait(200);

			await app.workbench.console.typeToConsole('Red');
			await app.workbench.console.sendEnterKey();
			await page.waitForTimeout(500);

			// Second input - focus should still be maintained
			await expect(app.workbench.console.activeConsole.getByText('Second:', { exact: true })).toBeVisible();
			await app.code.wait(200);

			await app.workbench.console.typeToConsole('Blue');
			await app.workbench.console.sendEnterKey();

			// After completion, verify output
			await page.waitForTimeout(1000);
			await app.workbench.console.waitForConsoleContents('Red and Blue');
		});
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
});

