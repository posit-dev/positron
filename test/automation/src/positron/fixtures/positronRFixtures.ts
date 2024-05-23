/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { Application } from '../../application';
import { InterpreterType } from '../positronStartInterpreter';

export class PositronRFixtures {

	constructor(private app: Application) { }

	async startRInterpreter() {

		const desiredR = process.env.POSITRON_R_VER_SEL;
		if (desiredR === undefined) {
			fail('Please be sure to set env var POSITRON_R_VER_SEL to the UI text corresponding to the R version for the test');
		}
		await this.app.workbench.positronConsole.selectInterpreter(InterpreterType.R, desiredR);

		await this.app.workbench.positronConsole.waitForReady('>');

		await this.app.workbench.positronConsole.logConsoleContents();


	}

}
