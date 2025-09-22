/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});


test.describe('Restart Host Extension', { tag: [tags.EXTENSIONS, tags.WIN] }, () => {

	test.afterEach(async ({ app }) => {
		await app.positron.sessions.deleteAll();
	});

	test('Verify Restart Extension Host command works - R', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		await app.positron.quickaccess.runCommand('workbench.action.restartExtensionHost');
		await app.positron.console.waitForConsoleContents('Extensions restarting...');
		await app.positron.console.waitForReady('>');
		await app.positron.console.pasteCodeToConsole('x<-1; y<-x+100; y', true);
		await app.positron.console.waitForConsoleContents('101');
	});

	test('Verify Restart Extension Host command works - Python', async function ({ app, python }) {
		await app.positron.quickaccess.runCommand('workbench.action.restartExtensionHost');
		await app.positron.console.waitForConsoleContents('Extensions restarting...');
		await app.positron.console.waitForReady('>>>');
		await app.positron.console.pasteCodeToConsole('x=1; y=x+100; print(y)', true);
		await app.positron.console.waitForConsoleContents('101');
	});

});
