/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 * Python console tests
 */
export function setup(logger: Logger) {
	describe('Console Pane: Python', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Console Restart', () => {

			before(async function () {
				// Need to make console bigger to see all bar buttons
				await this.app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
			});

			beforeEach(async function () {

				await PositronPythonFixtures.SetupFixtures(this.app as Application);

			});

			it('Verify restart button inside the console [C377918]', async function () {

				const app = this.app as Application;
				await expect(async () => {
					await app.workbench.positronConsole.barClearButton.click();
					await app.workbench.positronConsole.barPowerButton.click();
					await app.workbench.positronConsole.consoleRestartButton.click();
					await app.workbench.positronConsole.waitForReady('>>>');
					await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));
					await app.workbench.positronConsole.consoleRestartButton.isNotVisible();
				}).toPass();
			});

			it('Verify restart button on console bar [C617464]', async function () {

				const app = this.app as Application;
				await expect(async () => {
					await app.workbench.positronConsole.barClearButton.click();
					await app.workbench.positronConsole.barRestartButton.click();
					await app.workbench.positronConsole.waitForReady('>>>');
					await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));
				}).toPass();
			});

		});

	});
}
