/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('Console History', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Console History - Python', () => {
			before(async function () {
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			after(async function () {
				this.app.workbench.positronConsole.sendKeyboardKey('Escape');
			});

			const lineOne = 'a = 1';
			const lineTwo = 'b = 2';
			const lineThree = 'c = 3';
			it('Python - Verify Console History [C685945]', async function () {
				const app = this.app as Application;

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
		});

		describe('Console History - R', () => {
			before(async function () {
				// setup R but do not wait for a default interpreter to finish starting
				await PositronRFixtures.SetupFixtures(this.app as Application);
			});

			after(async function () {
				this.app.workbench.positronConsole.sendKeyboardKey('Escape');
			});

			it('R - Verify Console History [C685946]]', async function () {
				const app = this.app as Application;

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
	});
}
