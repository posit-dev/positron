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

			it('Python - Verify Console History [C685945]', async function () {
				const app = this.app as Application;

				await expect(async () => {
					await app.workbench.positronConsole.typeToConsole('a = 1');
					await app.workbench.positronConsole.sendEnterKey();

					await app.code.wait(200);

					await app.workbench.positronConsole.waitForPreviousConsoleLineContents(
						(lines) => lines.some((line) => line.includes('a = 1')));

					await app.workbench.positronConsole.typeToConsole('b = 2');
					await app.workbench.positronConsole.sendEnterKey();

					await app.code.wait(200);

					await app.workbench.positronConsole.waitForPreviousConsoleLineContents(
						(lines) => lines.some((line) => line.includes('b = 2')));

					await app.workbench.positronConsole.typeToConsole('c = 3');
					await app.workbench.positronConsole.sendEnterKey();

					await app.code.wait(200);

					await app.workbench.positronConsole.waitForPreviousConsoleLineContents(
						(lines) => lines.some((line) => line.includes('c = 3')));
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
					contents.some((line) => line.includes('a = 1')) &&
					contents.some((line) => line.includes('b = 2')) &&
					contents.some((line) => line.includes('c = 3')));

				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

			});
		});

		describe('Console History - R', () => {
			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);
			});

			after(async function () {
				this.app.workbench.positronConsole.sendKeyboardKey('Escape');
			});

			it('R - Verify Console History [C685946]]', async function () {
				const app = this.app as Application;

				await expect(async () => {
					await app.workbench.positronConsole.typeToConsole('a <- 1');
					await app.workbench.positronConsole.sendEnterKey();

					await app.code.wait(200);

					await app.workbench.positronConsole.waitForPreviousConsoleLineContents(
						(lines) => lines.some((line) => line.includes('a <- 1')));

					await app.workbench.positronConsole.typeToConsole('b <- 2');
					await app.workbench.positronConsole.sendEnterKey();

					await app.code.wait(200);

					await app.workbench.positronConsole.waitForPreviousConsoleLineContents(
						(lines) => lines.some((line) => line.includes('b <- 2')));

					await app.workbench.positronConsole.typeToConsole('c <- 3');
					await app.workbench.positronConsole.sendEnterKey();

					await app.code.wait(200);

					await app.workbench.positronConsole.waitForPreviousConsoleLineContents(
						(lines) => lines.some((line) => line.includes('c <- 3')));

				}).toPass({ timeout: 40000 });

				await app.code.wait(500);

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
					contents.some((line) => line.includes('a <- 1')) &&
					contents.some((line) => line.includes('b <- 2')) &&
					contents.some((line) => line.includes('c <- 3')));

				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

			});
		});
	});
}
