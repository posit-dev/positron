/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Note - these paths will need to change for your specific test location
import { Application, Logger, PositronPythonFixtures } from '../../../../automation';
import { installAllHandlers } from '../../utils';

export function setup(logger: Logger) {
	describe('Major Test Area', () => {
		// All Tests blocks inside this 'describe' block will use the same app instance
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Minor Test area', () => {

			before(async function () {
				// Executes once before executing all tests.
				// Change to 'beforeEach' if it needs to run before each individual test.
				const app = this.app as Application;
				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();
			});

			it('Sample Test Case A [TESTRAIL_ID]', async function () {
				const app = this.app as Application; //Get handle to application
				await app.workbench.positronConsole.barPowerButton.waitforVisible();
				this.code.logger.log("Waiting for Power button.");
			});

			it('Sample Test Case B [TESTRAIL_ID]', async function () {
				const app = this.app as Application; //Get handle to application
				await app.workbench.positronConsole.barRestartButton.waitforVisible();
				this.code.logger.log("Waiting for Power button.");
			});

		});

	});
}
