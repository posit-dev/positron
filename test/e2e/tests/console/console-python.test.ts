/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Pane: Python', { tag: [tags.WEB, tags.CONSOLE, tags.WIN] }, () => {

	test('Python - Verify restart button on console bar', async function ({ app, python }) {
		// Need to make console bigger to see all bar buttons
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.console.barClearButton.click();

		// workaround issue where "started" text never appears post restart
		await app.code.wait(1000);
		await app.workbench.console.barRestartButton.click();

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.console.waitForReady('>>>');
	});

	test('Python - Verify cancel button on console bar', async function ({ app, python }) {
		await app.workbench.console.typeToConsole('import time', true);
		await app.workbench.console.typeToConsole('time.sleep(10)', true);
		await app.workbench.console.interruptExecution();
	});

	test.fixme('Python - Verify alternate python can skip bundled ipykernel', async function ({ app, sessions, userSettings }) {
		await userSettings.set([['python.useBundledIpykernel', 'false']], true);
		await sessions.start('pythonAlt');

		await app.workbench.console.barClearButton.click();
		await app.workbench.console.pasteCodeToConsole(`import ipykernel; ipykernel.__file__`, true);
		await app.workbench.console.waitForConsoleContents('site-packages');
	});
});
