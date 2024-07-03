/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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

			beforeEach(async function () {

				const app = this.app as Application;
				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();

			});

			it('Verify restart button inside the console [C377918]', async function () {
				this.retries(1);
				const app = this.app as Application;
				// Need to make console bigger to see all bar buttons
				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
				await app.workbench.positronConsole.barClearButton.click();
				await app.workbench.positronConsole.barPowerButton.click();
				await app.workbench.positronConsole.consoleRestartButton.click();
				await app.workbench.positronConsole.waitForReady('>>>');
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));
				await app.workbench.positronConsole.consoleRestartButton.isNotVisible();
			});

			it('Verify restart button on console bar [C617464]', async function () {
				this.retries(1);
				const app = this.app as Application;
				// Need to make console bigger to see all bar buttons
				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
				await app.workbench.positronConsole.barClearButton.click();
				await app.workbench.positronConsole.barRestartButton.click();
				await app.workbench.positronConsole.waitForReady('>>>');
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));
			});

		});

	});
}
