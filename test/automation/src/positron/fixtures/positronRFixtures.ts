/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { Application } from '../../application';
import { InterpreterType } from '../positronStartInterpreter';
import { InterpreterInfo } from '../positronConsole';

/*
 *  Reuseable Positron R fixture tests can leverage to get an R interpreter selected.
 */
export class PositronRFixtures {

	constructor(private app: Application) { }

	async startRInterpreter(): Promise<InterpreterInfo | undefined> {

		const desiredR = process.env.POSITRON_R_VER_SEL;
		if (desiredR === undefined) {
			fail('Please be sure to set env var POSITRON_R_VER_SEL to the UI text corresponding to the R version for the test');
		}
		const interpreterInfo = await this.app.workbench.positronConsole.selectAndGetInterpreter(InterpreterType.R, desiredR);

		await this.app.workbench.positronConsole.waitForReady('>');

		await this.app.workbench.positronConsole.logConsoleContents();

		return interpreterInfo;
	}

}
