/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console History', {
	tag: [tags.WEB, tags.WIN, tags.CONSOLE]
}, () => {
	test.afterEach(async function ({ app }) {
		app.workbench.positronConsole.sendKeyboardKey('Escape');
	});

	test('Python - Verify Console History [C685945]', async function ({ app, python }) {
		const lineOne = 'a = 1';
		const lineTwo = 'b = 2';
		const lineThree = 'c = 3';

		await expect(async () => {
			await app.workbench.positronConsole.typeToConsole(lineOne);
			await app.workbench.positronConsole.sendEnterKey();

			await app.workbench.positronConsole.waitForConsoleContents(
				(lines) => lines.some((line) => line.includes(lineOne)));

			await app.workbench.positronConsole.typeToConsole(lineTwo);
			await app.workbench.positronConsole.sendEnterKey();

			await app.workbench.positronConsole.waitForConsoleContents(
				(lines) => lines.some((line) => line.includes(lineTwo)));

			await app.workbench.positronConsole.typeToConsole(lineThree);
			await app.workbench.positronConsole.sendEnterKey();

			await app.workbench.positronConsole.waitForConsoleContents(
				(lines) => lines.some((line) => line.includes(lineThree)));
		}).toPass({ timeout: 40000 });

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.workbench.positronConsole.barClearButton.click();

		await app.workbench.positronConsole.sendKeyboardKey('ArrowUp');
		await app.workbench.positronConsole.sendKeyboardKey('ArrowUp');
		await app.workbench.positronConsole.sendKeyboardKey('ArrowUp');

		await app.workbench.positronConsole.waitForCurrentConsoleLineContents((line) =>
			line.includes('a = 1'));

		await app.workbench.positronConsole.sendEnterKey();

		await app.workbench.positronConsole.sendKeyboardKey('Control+R');

		await app.workbench.positronConsole.waitForHistoryContents((contents) =>
			contents.some((line) => line.includes(lineOne)) &&
			contents.some((line) => line.includes(lineTwo)) &&
			contents.some((line) => line.includes(lineThree)));

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

	});


	test('R - Verify Console History [C685946]]', async function ({ app, r }) {
		const lineOne = 'a <- 1';
		const lineTwo = 'b <- 2';
		const lineThree = 'c <- 3';
		await expect(async () => {
			// send test line one and the enter key, then expect it in the previous console
			// lines
			await app.workbench.positronConsole.typeToConsole(lineOne);
			await app.workbench.positronConsole.sendEnterKey();
			await app.workbench.positronConsole.waitForConsoleContents(
				(lines) => lines.some((line) => line.includes(lineOne)));

			// send test line two and the enter key, then expect it in the previous console
			// lines
			await app.workbench.positronConsole.typeToConsole(lineTwo);
			await app.workbench.positronConsole.sendEnterKey();
			await app.workbench.positronConsole.waitForConsoleContents(
				(lines) => lines.some((line) => line.includes(lineTwo)));

			// send test line three and the enter key, then expect it in the previous console
			// lines
			await app.workbench.positronConsole.typeToConsole(lineThree);
			await app.workbench.positronConsole.sendEnterKey();
			await app.workbench.positronConsole.waitForConsoleContents(
				(lines) => lines.some((line) => line.includes(lineThree)));

		}).toPass({ timeout: 40000 });

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.positronConsole.barClearButton.click();

		await app.workbench.positronConsole.sendKeyboardKey('ArrowUp');
		await app.workbench.positronConsole.sendKeyboardKey('ArrowUp');
		await app.workbench.positronConsole.sendKeyboardKey('ArrowUp');

		await app.workbench.positronConsole.waitForCurrentConsoleLineContents((line) =>
			line.includes('a <- 1'));

		await app.workbench.positronConsole.sendEnterKey();

		await app.workbench.positronConsole.sendKeyboardKey('Control+R');

		await app.workbench.positronConsole.waitForHistoryContents((contents) =>
			contents.some((line) => line.includes(lineOne)) &&
			contents.some((line) => line.includes(lineTwo)) &&
			contents.some((line) => line.includes(lineThree)));

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

	});
});
