/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { Application } from '../../application';
import { InterpreterType } from '../utils/interpreterInfo';
import { expect } from '@playwright/test';

/*
 *  Reuseable Positron Python fixture tests can leverage to get a Python interpreter selected.
 */
export class PositronPythonFixtures {

	constructor(private app: Application) { }

	static async SetupFixtures(app: Application, skipReadinessCheck: boolean = false) {
		const fixtures = new PositronPythonFixtures(app);
		await fixtures.startPythonInterpreter(skipReadinessCheck);
	}

	async startPythonInterpreter(skipReadinessCheck: boolean = false) {

		const desiredPython = process.env.POSITRON_PY_VER_SEL;
		if (desiredPython === undefined) {
			fail('Please be sure to set env var POSITRON_PY_VER_SEL to the UI text corresponding to the Python version for the test');
		}

		try {
			await this.app.workbench.console.selectInterpreter(InterpreterType.Python, desiredPython, skipReadinessCheck);
			await this.app.workbench.console.waitForReady('>>>', 40000);
		} catch (e) {
			await this.app.code.driver.takeScreenshot('startPythonInterpreter');
			throw e;
		}
		await this.app.workbench.console.logConsoleContents();
	}

	async startAndGetPythonInterpreter(installIPyKernelIfPrompted: boolean = false): Promise<void> {
		const desiredPython = process.env.POSITRON_PY_VER_SEL;
		if (desiredPython === undefined) {
			fail('Please be sure to set env var POSITRON_PY_VER_SEL to the UI text corresponding to the Python version for the test');
		}
		await this.app.workbench.console.selectInterpreter(InterpreterType.Python, desiredPython);

		if (
			installIPyKernelIfPrompted &&
			(await this.app.workbench.popups.popupCurrentlyOpen())
		) {
			await this.app.workbench.popups.installIPyKernel();
		}

		await expect(this.app.workbench.console.activeConsole.getByText('>>>')).toBeVisible({ timeout: 30000 });
		await this.app.workbench.console.logConsoleContents();
	}

}
