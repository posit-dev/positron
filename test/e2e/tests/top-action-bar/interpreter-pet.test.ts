/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const desiredPython = process.env.POSITRON_PY_VER_SEL!;

test.describe('Top Action Bar - Interpreter Dropdown', {
	tag: [tags.WEB, tags.CRITICAL, tags.WIN, tags.TOP_ACTION_BAR, tags.INTERPRETER]
}, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.console.barClearButton.click();
	});

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['python.locator', 'native']]);
	});

	test('Python - interpreter starts and shows running', async function ({ app }) {
		await app.workbench.interpreter.selectInterpreter('Python', desiredPython);
		await app.workbench.interpreter.verifyInterpreterIsSelected(desiredPython);
		await app.workbench.interpreter.verifyInterpreterIsRunning(desiredPython);
	});
});
