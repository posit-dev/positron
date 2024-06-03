/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('Console Pane: R', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('R Console Restart', () => {

			before(async function () {

				const app = this.app as Application;
				const RFixtures = new PositronRFixtures(app);
				await RFixtures.startRInterpreter();

			});

			it('Verify restart button inside the console', async function () {
				// TestRail #377917
				const app = this.app as Application;
				// Need to make console bigger to see all bar buttons
				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
				await app.workbench.positronConsole.barClearButton.click();
				await app.workbench.positronConsole.barPowerButton.click();
				await app.workbench.positronConsole.consoleRestartButton.click();
				await app.workbench.positronConsole.waitForReady('>');
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));
				await app.workbench.positronConsole.consoleRestartButton.isNotVisible();
			});

			it('Verify restart button on console bar', async function () {
				// TestRail #620636
				const app = this.app as Application;
				// Need to make console bigger to see all bar buttons
				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
				await app.workbench.positronConsole.barClearButton.click();
				await app.workbench.positronConsole.barRestartButton.click();
				await app.workbench.positronConsole.waitForReady('>');
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));
			});

		});

	});
}
