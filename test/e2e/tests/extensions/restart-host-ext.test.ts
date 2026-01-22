/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// FIXME: Disabled for https://github.com/posit-dev/positron/pull/11407 on windows
test.describe('Restart Host Extension', { tag: [tags.EXTENSIONS] }, () => {

	test.afterEach(async ({ app }) => {
		await app.workbench.sessions.deleteAll();
	});


	test('Verify Restart Extension Host command works - R', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		await app.workbench.quickaccess.runCommand('workbench.action.restartExtensionHost');
		await app.workbench.console.waitForConsoleContents('Extensions restarting...');
		await app.workbench.console.waitForReady('>');
		await app.workbench.console.pasteCodeToConsole('x<-1; y<-x+100; y', true);
		await app.workbench.console.waitForConsoleContents('101');
	});

	test('Verify Restart Extension Host command works - Python', async function ({ app, python }) {
		await app.workbench.quickaccess.runCommand('workbench.action.restartExtensionHost');
		await app.workbench.console.waitForConsoleContents('Extensions restarting...');
		await app.workbench.console.waitForReady('>>>');
		await app.workbench.console.pasteCodeToConsole('x=1; y=x+100; print(y)', true);
		await app.workbench.console.waitForConsoleContents('101');
	});

});
