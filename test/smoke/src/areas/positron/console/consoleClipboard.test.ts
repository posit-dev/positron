/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


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

			await app.workbench.positronConsole.typeToConsole('a = 1');

			const page = activeConsole!.page();
			await page.keyboard.press(`${modifier}+A`);
			await page.keyboard.press(`${modifier}+C`);

			await app.workbench.positronConsole.sendEnterKey();

			await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('a = 1')));

			await app.workbench.positronConsole.barClearButton.click();

			await app.workbench.positronConsole.waitForConsoleContents((contents) => {
				return !contents.some(Boolean);
			});

			await page.keyboard.press(`${modifier}+V`);
			await app.workbench.positronConsole.sendEnterKey();

			await app.workbench.positronConsole.waitForConsoleContents((contents) =>
				contents.some((line) => line.includes('a = 1'))
			);

			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		}

		describe('Console Clipboard - Python', () => {
			before(async function () {
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			it('Python - Copy from console & paste to console [C608100] #nightly', async function () {
				await testBody(this.app);
			});
		});

		describe('Console Clipboard - R', () => {
			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);
			});

			it('R - Copy from console & paste to console [C663725] #nightly', async function () {
				await testBody(this.app);
			});
		});
	});
}
