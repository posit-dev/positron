/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, PositronRFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../positronUtils';

describe('Console Pane: R', () => {
	setupAndStartApp();

	describe('R Console Restart #web #win', () => {

		before(async function () {
			// Need to make console bigger to see all bar buttons
			await this.app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		});

		beforeEach(async function () {

			await PositronRFixtures.SetupFixtures(this.app as Application);

		});

		it('Verify restart button inside the console [C377917]', async function () {
			const app = this.app as Application;
			await expect(async () => {
				await app.workbench.positronConsole.barClearButton.click();
				await app.workbench.positronConsole.barPowerButton.click();
				await app.workbench.positronConsole.consoleRestartButton.click();
				await app.workbench.positronConsole.waitForReady('>');
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));
				await app.workbench.positronConsole.consoleRestartButton.isNotVisible();
			}).toPass();
		});

		it('Verify restart button on console bar [C620636]', async function () {
			const app = this.app as Application;
			await expect(async () => {
				await app.workbench.positronConsole.barClearButton.click();
				await app.workbench.positronConsole.barRestartButton.click();
				await app.workbench.positronConsole.waitForReady('>');
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));
			}).toPass();
		});

	});

});
