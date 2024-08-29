/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { Application } from '../../application';
import { InterpreterType } from '../utils/positronInterpreterInfo';

/*
 *  Reuseable Positron R fixture tests can leverage to get an R interpreter selected.
 */
export class PositronRFixtures {

	constructor(private app: Application) { }

	static async SetupFixtures(app: Application, skipReadinessCheck: boolean = false) {
		const fixtures = new PositronRFixtures(app);
		await fixtures.startRInterpreter(skipReadinessCheck);
	}

	async startRInterpreter(skipReadinessCheck: boolean = false) {

		const desiredR = process.env.POSITRON_R_VER_SEL;
		if (desiredR === undefined) {
			fail('Please be sure to set env var POSITRON_R_VER_SEL to the UI text corresponding to the R version for the test');
		}


		// We currently don't capture fixtures in the Playwright trace, so take a screenshot on failure
		try {
			await this.app.workbench.positronConsole.selectInterpreter(InterpreterType.R, desiredR, skipReadinessCheck);
			await this.app.workbench.positronConsole.waitForReady('>', 2000);
		} catch (e) {
			this.app.code.driver.takeScreenshot('startRInterpreter');
			throw e;
		}

		await this.app.workbench.positronConsole.logConsoleContents();


	}

}
