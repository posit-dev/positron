/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const desiredPython = process.env.POSITRON_PY_VER_SEL!;
const desiredR = process.env.POSITRON_R_VER_SEL!;

test.describe('Interpreter Dropdown in Top Action Bar', { tag: [tags.WEB, tags.TOP_ACTION_BAR] }, () => {

	test.beforeAll(async function ({ app }) {
		await app.workbench.console.waitForReadyOrNoInterpreter();
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.console.barClearButton.click();
	});

	test('Python - starts and shows running [C707212]', async function ({ app }) {
		await app.workbench.interpreterDropdown.selectInterpreter('Python', desiredPython);

		// verify the selected interpreter is the desired interpreter
		const interpreterInfo = await app.workbench.interpreterDropdown.getSelectedInterpreterInfo();
		expect(interpreterInfo!.version).toContain(desiredPython);

		// verify the selected interpreter is running
		await app.workbench.interpreterDropdown.verifyInterpreterIsRunning(desiredPython);
	});

	test('Python - restarts and shows running [C707213]', async function ({ app, python }) {
		await app.workbench.console.barClearButton.click();

		// Restart the active Python interpreter
		await app.workbench.interpreterDropdown.restartPrimaryInterpreter('Python');

		// The console should indicate that the interpreter is restarting
		await app.workbench.console.waitForConsoleContents('preparing for restart');
		await app.workbench.console.waitForConsoleContents('restarted');
		await app.workbench.console.waitForReady('>>>', 10000);

		// verify the selected interpreter is running
		await app.workbench.interpreterDropdown.verifyInterpreterIsRunning(desiredPython);
	});

	test('R - starts and shows running [C707214]', async function ({ app }) {
		await app.workbench.interpreterDropdown.selectInterpreter('R', desiredR);
		await app.workbench.console.waitForReady('>', 10_000);

		const interpreterInfo = await app.workbench.interpreterDropdown.getSelectedInterpreterInfo();
		expect(interpreterInfo!.version).toContain(desiredR);

		await app.workbench.interpreterDropdown.verifyInterpreterIsRunning(desiredR);
	});

	test('R - stops and shows inactive [C707215]', async function ({ app, r }) {
		const desiredR = process.env.POSITRON_R_VER_SEL!;

		await app.workbench.interpreterDropdown.stopPrimaryInterpreter(desiredR);
		await app.workbench.interpreterDropdown.closeInterpreterDropdown();

		await app.workbench.console.waitForInterpreterShutdown();
		await app.workbench.interpreterDropdown.verifyInterpreterIsInactive(desiredR);
	});
});
