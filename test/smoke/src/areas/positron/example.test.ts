/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Note - these paths will need to change for your specific test location
import { Application, PositronPythonFixtures } from '../../../../automation';
import { setupEnvAndHooks } from '../../positronUtils';

describe('Major Test Area', () => {
	// Shared before/after look which returns logger (in case you need to log in test)
	setupEnvAndHooks();

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

