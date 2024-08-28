/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import * as os from 'os';

export function setup(logger: Logger) {
	describe('Console', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		const isMac = os.platform() === 'darwin';
		const modifier = isMac ? 'Meta' : 'Control';

		async function testBody(app: Application) {
			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

			const activeConsole = app.workbench.positronConsole.activeConsole;
			await activeConsole.click();
			const page = activeConsole!.page();

			const testLine = 'a = 1';

			await expect(async () => {
				// Ensure nothing is in the current line and clear the console
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.barClearButton.click();

				// Send test line to console
				await app.workbench.positronConsole.typeToConsole(testLine);

				// copy the test line and send enter key
				await page.keyboard.press(`${modifier}+A`);
				await page.keyboard.press(`${modifier}+C`);
				await app.workbench.positronConsole.sendEnterKey();

				// ensure the console previous lines contain the test line
				await app.workbench.positronConsole.waitForConsoleContents(
					(lines) => lines.some((line) => line.includes(testLine)));

				// clear the console and ensure the clear succeeded
				await app.workbench.positronConsole.barClearButton.click();
				await app.workbench.positronConsole.waitForConsoleContents((contents) => {
					return !contents.some(Boolean);
				});
			}).toPass({ timeout: 40000 });

			await page.keyboard.press(`${modifier}+V`);

			await app.workbench.positronConsole.waitForCurrentConsoleLineContents((line) =>
				line.includes(testLine.replaceAll(' ', ' ')));

			await app.workbench.positronConsole.sendEnterKey();

			// check for two instances of the test line in a row (invalid)
			await app.workbench.positronConsole.waitForConsoleContents((contents) =>
				contents.some((line) => line.includes(testLine))
			);

			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		}

		describe('Console Clipboard - Python', () => {
			before(async function () {
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			it('Python - Copy from console & paste to console [C608100]', async function () {
				await testBody(this.app);
			});
		});

		describe('Console Clipboard - R', () => {
			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);
			});

			it('R - Copy from console & paste to console [C663725]', async function () {
				await testBody(this.app);
			});
		});
	});
}
