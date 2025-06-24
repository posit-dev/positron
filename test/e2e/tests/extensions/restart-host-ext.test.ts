/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});


test.describe('Restart Host Extension', {
	tag: [tags.EXTENSIONS, tags.WEB, tags.WIN],
}, () => {

	test('Verify Restart Extension Host command works - R', async function ({ app, r }) {
		await app.workbench.quickaccess.runCommand('workbench.action.restartExtensionHost');
		await app.workbench.console.waitForConsoleContents('Extensions restarting...');
		await expect(app.workbench.console.activeConsole.locator('.current-line')).toBeVisible();
		await app.workbench.console.pasteCodeToConsole('x=1; y=x+100', true);
		await app.workbench.console.pasteCodeToConsole('y', true);
		await app.workbench.console.waitForConsoleContents('101');
	});

	test('Verify Restart Extension Host command works - Python', async function ({ app, python }) {
		await app.workbench.quickaccess.runCommand('workbench.action.restartExtensionHost');
		await app.workbench.console.waitForConsoleContents('Extensions restarting...');
		await expect(app.workbench.console.activeConsole.locator('.current-line')).toBeVisible();
		await app.workbench.console.pasteCodeToConsole('x=1; y=x+100', true);
		await app.workbench.console.pasteCodeToConsole('print(y)', true);
		await app.workbench.console.waitForConsoleContents('101');
	});

});
