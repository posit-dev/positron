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
				// TestRail 608100

				const activeConsole = app.workbench.positronConsole.getActiveConsole();
				await activeConsole?.click();

				await app.workbench.positronConsole.typeToConsole('a = 1');

				const page = activeConsole!.page();
				await page.keyboard.press(`${modifier}+A`);
				await page.keyboard.press(`${modifier}+C`);

				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('a = 1')) );

				await app.workbench.positronConsole.barClearButton.click();

				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.length === 0 );

				await page.keyboard.press(`${modifier}+V`);
				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronConsole.waitForConsoleContents((contents) =>
					contents.some((line) => line.includes('a = 1'))
				);
		}

		describe('Console Clipboard - Python', () => {
			before(async function () {
				const app = this.app as Application;
				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();
			});

			it.only('Python - Copy from console & paste to console', async function () {
				await testBody(this.app);
			});
		});

		describe('Console Clipboard - R', () => {
			before(async function () {
				const app = this.app as Application;
				const pythonFixtures = new PositronRFixtures(app);
				await pythonFixtures.startRInterpreter();
			});

			it.only('R - Copy from console & paste to console', async function () {
				await testBody(this.app);
			});
		});
	});
}
