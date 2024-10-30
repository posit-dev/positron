/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, PositronPythonFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';

describe('Console Pane: Python #web #win', () => {
	setupAndStartApp();

	describe('Python Console Restart', () => {

		beforeEach(async function () {

			await PositronPythonFixtures.SetupFixtures(this.app as Application);

		});

		it('Verify restart button inside the console [C377918]', async function () {

			const app = this.app as Application;
			await expect(async () => {
				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
				await app.workbench.positronConsole.barClearButton.click();

				// workaround issue where power button click fails
				await app.code.wait(1000);

				await app.workbench.positronConsole.barPowerButton.click();
				await app.workbench.positronConsole.consoleRestartButton.click();

				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

				await app.workbench.positronConsole.waitForReady('>>>');
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));
				await app.workbench.positronConsole.consoleRestartButton.isNotVisible();
			}).toPass();
		});

		it('Verify restart button on console bar [C617464]', async function () {
			this.retries(1);
			const app = this.app as Application;
			// Need to make console bigger to see all bar buttons
			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
			await app.workbench.positronConsole.barClearButton.click();

			// workaround issue where "started" text never appears post restart
			await app.code.wait(1000);

			await app.workbench.positronConsole.barRestartButton.click();

			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

			await app.workbench.positronConsole.waitForReady('>>>');
			await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));
		});

	});

});
