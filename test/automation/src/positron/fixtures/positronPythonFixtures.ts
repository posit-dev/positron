/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { Application } from '../../application';
import { InterpreterType } from '../positronStartInterpreter';
import { InterpreterInfo } from '../positronConsole';

/*
 *  Reuseable Positron Python fixture tests can leverage to get a Python interpreter selected.
 */
export class PositronPythonFixtures {

	constructor(private app: Application) { }

	async startPythonInterpreter(installIPyKernelIfPrompted: boolean = false): Promise<InterpreterInfo | undefined> {

		const desiredPython = process.env.POSITRON_PY_VER_SEL;
		if (desiredPython === undefined) {
			fail('Please be sure to set env var POSITRON_PY_VER_SEL to the UI text corresponding to the Python version for the test');
		}
		const interpreterInfo = await this.app.workbench.positronConsole.selectAndGetInterpreter(InterpreterType.Python, desiredPython);

		if (
			installIPyKernelIfPrompted &&
			(await this.app.workbench.positronPopups.popupCurrentlyOpen())
		) {
			await this.app.workbench.positronPopups.installIPyKernel();
		}

		await this.app.workbench.positronConsole.waitForReady('>>>');

		await this.app.workbench.positronConsole.logConsoleContents();

		return interpreterInfo;
	}

}
