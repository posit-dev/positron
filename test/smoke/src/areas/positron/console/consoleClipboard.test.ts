/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Application, Logger, PositronPythonFixtures, PositronRFixtures, readClipboard } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import * as os from 'os';
import { expect } from '@playwright/test';

export function setup(logger: Logger) {
	describe('Console', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		const isMac = os.platform() === 'darwin';
		const modifier = isMac ? 'Meta' : 'Control';

		describe('Console Clipboard - Python', () => {
			before(async function () {
				const app = this.app as Application;
				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();
			});

			it('Python - Copy from console & paste to console', async function () {
				// TestRail 608100
				const app = this.app as Application;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('Python', 'a = b', '>>>');

				await app.workbench.positronConsole.waitForConsoleContents((contents) =>
					contents.some((line) => line.includes('NameError'))
				);

				const activeConsole = app.workbench.positronConsole.getActiveConsole();
				await activeConsole?.click();

				const page = activeConsole!.page();
				await page.keyboard.press(`${modifier}+A`);
				await page.keyboard.press(`${modifier}+C`);

				const inClipboard = readClipboard();

				expect(inClipboard).toContain('NameError');

				await page.keyboard.press(`${modifier}+V`);
				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronConsole.waitForConsoleContents((contents) =>
					contents.some((line) => line.includes('invalid syntax'))
				);
			});
		});

		describe('Console Clipboard - R', () => {
			before(async function () {
				const app = this.app as Application;
				const pythonFixtures = new PositronRFixtures(app);
				await pythonFixtures.startRInterpreter();
			});

			it('R - Copy from console & paste to console', async function () {
				// TestRail 608100
				const app = this.app as Application;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('R', 'a = b', '>');

				await app.workbench.positronConsole.waitForConsoleContents((contents) =>
					contents.some((line) => line.includes("object 'b' not found"))
				);

				const activeConsole = app.workbench.positronConsole.getActiveConsole();
				await activeConsole?.click();

				const page = activeConsole!.page();
				await page.keyboard.press(`${modifier}+A`);
				await page.keyboard.press(`${modifier}+C`);

				const inClipboard = readClipboard();

				expect(inClipboard).toContain("object 'b' not found");

				await page.keyboard.press(`${modifier}+V`);
				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronConsole.waitForConsoleContents((contents) =>
					contents.some((line) => line.includes('unexpected numeric constant in "R 4.3"'))
				);
			});
		});
	});
}
