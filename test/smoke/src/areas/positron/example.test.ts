/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Note - these paths will need to change for your specific test location
import { Application, PositronPythonFixtures } from '../../../../automation';
import { setupAndStartApp } from '../../test-runner/test-hooks';

describe('Major Test Area', () => {
	// Needed at parent `describe` block to setup shared before/after hooks
	// It does return the logger (in case you want/need to log in test)
	setupAndStartApp();

	describe('Minor Test area', () => {

		before(async function () {
			// Executes once before executing all tests.
			// Change to 'beforeEach' if it needs to run before each individual test.
			await PositronPythonFixtures.SetupFixtures(this.app as Application);
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

