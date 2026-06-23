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

		// https://github.com/posit-dev/positron/issues/11758: focus must remain in the console while input() waits
		await expect(app.workbench.console.activeConsole.locator('.activity-prompt .native-edit-context')).toBeFocused();

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

		// https://github.com/posit-dev/positron/issues/11758: focus must remain in the console while readline() waits
		await expect(app.workbench.console.activeConsole.locator('.activity-prompt .native-edit-context')).toBeFocused();

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

	test('Python - Clicking output while scrolled up focuses input without yanking the viewport', async function ({ app, page, python }) {
		// Regression test for https://github.com/posit-dev/positron/issues/11772 and
		// https://github.com/posit-dev/positron/issues/13991: clicking the console while
		// scrolled up should focus the input without scrolling the viewport to the bottom,
		// and typing should then scroll the input back into view.
		const { console } = app.workbench;
		const activeConsole = console.activeConsole;
		const editContext = activeConsole.locator('.console-input .native-edit-context');

		await test.step('Generate enough output to make the console scrollable', async () => {
			await console.clearInput();
			await console.pasteCodeToConsole('for i in range(200): print(f"scrollA {i}")', true);
			await console.waitForConsoleContents('scrollA 199');
		});

		const scrollTopBefore = await test.step('Scroll up to view history', async () => {
			// Use the mouse wheel to scroll up, which engages scroll lock immediately.
			const box = await activeConsole.boundingBox();
			await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
			await page.mouse.wheel(0, -10000);
			await expect.poll(() => activeConsole.evaluate(el => el.scrollTop)).toBeLessThan(5);
			return activeConsole.evaluate(el => el.scrollTop);
		});

		await test.step('Click the output and verify the input is focused without scrolling', async () => {
			await activeConsole.click({ position: { x: 10, y: 10 } });
			await expect(editContext).toBeFocused();
			// The viewport must not have jumped to the bottom (#11772).
			await expect.poll(() => activeConsole.evaluate(el => el.scrollTop)).toBeLessThanOrEqual(scrollTopBefore + 2);
		});

		await test.step('Type and verify the input scrolls back into view', async () => {
			await page.keyboard.type('1 + 1');
			await expect.poll(() => activeConsole.evaluate(
				el => el.scrollHeight - el.clientHeight - el.scrollTop
			)).toBeLessThan(5);
		});
	});

	test('Python - Clicking back into a scrolled-up console refocuses the input and buffers typing', async function ({ app, page, python }) {
		// Regression test for the prior "skip focus when scrolled up" approach, which left the
		// input unfocused when clicking a scrolled-up console (#11772). Clicking back in should
		// refocus the input without yanking the viewport, and typing should buffer correctly.
		const { console } = app.workbench;
		const activeConsole = console.activeConsole;
		const editContext = activeConsole.locator('.console-input .native-edit-context');
		const consoleInput = activeConsole.locator('.console-input');

		await test.step('Generate output and scroll up to view history', async () => {
			await console.clearInput();
			await console.pasteCodeToConsole('for i in range(200): print(f"scrollB {i}")', true);
			await console.waitForConsoleContents('scrollB 199');
			const box = await activeConsole.boundingBox();
			await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
			await page.mouse.wheel(0, -10000);
			await expect.poll(() => activeConsole.evaluate(el => el.scrollTop)).toBeLessThan(5);
		});

		await test.step('Move focus out of the console input', async () => {
			await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
			await expect(editContext).not.toBeFocused();
		});

		const scrollTopBefore = await activeConsole.evaluate(el => el.scrollTop);

		await test.step('Click back into the console and verify the input refocuses without scrolling', async () => {
			await activeConsole.click({ position: { x: 10, y: 10 } });
			await expect(editContext).toBeFocused();
			await expect.poll(() => activeConsole.evaluate(el => el.scrollTop)).toBeLessThanOrEqual(scrollTopBefore + 2);
		});

		await test.step('Verify typing buffers correctly', async () => {
			await page.keyboard.type('x = 42');
			await expect(consoleInput).toContainText('x = 42');
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

