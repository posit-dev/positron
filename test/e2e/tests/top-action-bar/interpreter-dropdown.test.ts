/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const desiredPython = process.env.POSITRON_PY_VER_SEL!;
const desiredR = process.env.POSITRON_R_VER_SEL!;

test.describe('Top Action Bar - Interpreter Dropdown', {
	tag: [tags.WEB, tags.TOP_ACTION_BAR, tags.INTERPRETER, tags.CRITICAL]
}, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.console.barClearButton.click();
	});

	test('Python - starts and shows running [C707212]', async function ({ app }) {
		await app.workbench.interpreter.selectInterpreter('Python', desiredPython);
		await app.workbench.interpreter.verifyInterpreterIsSelected(desiredPython);
		await app.workbench.interpreter.verifyInterpreterIsRunning(desiredPython);
	});

	test('Python - restarts and shows running [C707213]', async function ({ app, python }) {
		await app.workbench.interpreter.restartPrimaryInterpreter('Python');
		await app.workbench.interpreter.verifyInterpreterRestarted('Python');
		await app.workbench.interpreter.verifyInterpreterIsRunning(desiredPython);
	});

	test('R - starts and shows running [C707214]', async function ({ app }) {
		await app.workbench.interpreter.selectInterpreter('R', desiredR);
		await app.workbench.interpreter.verifyInterpreterIsSelected(desiredR);
		await app.workbench.interpreter.verifyInterpreterIsRunning(desiredR);
	});

	test('R - stops and shows inactive [C707215]', async function ({ app, r }) {
		await app.workbench.interpreter.stopPrimaryInterpreter(desiredR);
		await app.workbench.interpreter.verifyInterpreterIsInactive(desiredR);
	});
});
