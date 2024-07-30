/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { Application } from '../../application';
import { InterpreterInfo, InterpreterType } from '../utils/positronInterpreterInfo';

/*
 *  Reuseable Positron Python fixture tests can leverage to get a Python interpreter selected.
 */
export class PositronPythonFixtures {

	constructor(private app: Application) { }

	static async SetupFixtures(app: Application) {
		const fixtures = new PositronPythonFixtures(app);
		await fixtures.startPythonInterpreter();
	}

	async startPythonInterpreter() {

		const desiredPython = process.env.POSITRON_PY_VER_SEL;
		if (desiredPython === undefined) {
			fail('Please be sure to set env var POSITRON_PY_VER_SEL to the UI text corresponding to the Python version for the test');
		}
		await this.app.workbench.positronConsole.selectInterpreter(InterpreterType.Python, desiredPython);

		await this.app.workbench.positronConsole.waitForReady('>>>', 2000);

		await this.app.workbench.positronConsole.logConsoleContents();
	}

	async startAndGetPythonInterpreter(installIPyKernelIfPrompted: boolean = false): Promise<InterpreterInfo | undefined> {
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

		await this.app.workbench.positronConsole.waitForReady('>>>', 2000);

		await this.app.workbench.positronConsole.logConsoleContents();

		return interpreterInfo;
	}

}
