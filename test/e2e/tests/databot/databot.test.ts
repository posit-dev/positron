/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Databot', {
	tag: [tags.ASSISTANT, tags.DATABOT, tags.WEB, tags.WIN],
}, () => {

	test.beforeAll(async function ({ app, sessions }) {
		await app.workbench.extensions.installExtension('posit.databot', true);
		await app.workbench.assistant.loginModelProvider('anthropic-api');
		await sessions.start(['python', 'r'], { reuse: true });
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.hotKeys.closeAllEditors();
	});

	test('Execute Python code via Databot', async function ({ app, sessions }) {
		await sessions.restart('Python');
		await app.workbench.databot.open();
		await app.workbench.databot.waitForReady();

		await app.workbench.databot.sendMessage('Print "hello world" in python', false);
		await app.workbench.databot.expectToolConfirmVisible();
		await app.workbench.databot.allowToolOnce();
		await app.workbench.databot.waitForResponseComplete();
		await app.workbench.console.waitForConsoleContents('hello world', { expectedCount: 2 });
	});

	test('Execute R code via Databot', async function ({ app, sessions }) {
		await sessions.restart('R');
		await app.workbench.databot.open();
		await app.workbench.databot.waitForReady();

		await app.workbench.databot.sendMessage('Print "hello world" in R', false);
		await app.workbench.databot.expectToolConfirmVisible();
		await app.workbench.databot.allowToolOnce();
		await app.workbench.databot.waitForResponseComplete();
		await app.workbench.console.waitForConsoleContents('hello world', { expectedCount: 2 });
	});

	test('Allow once prompts again on next tool call', async function ({ app, sessions }) {
		await sessions.restart('Python');
		await app.workbench.databot.open();
		await app.workbench.databot.waitForReady();

		// First tool call - allow once
		await app.workbench.databot.sendMessage('Print "first" in python', false);
		await app.workbench.databot.expectToolConfirmVisible();
		await app.workbench.databot.allowToolOnce();
		await app.workbench.databot.waitForResponseComplete();

		// Second tool call - should prompt again
		await app.workbench.databot.sendMessage('Print "second" in python', false, { newConversation: false });
		await app.workbench.databot.expectToolConfirmVisible();
		await app.workbench.databot.allowToolOnce();
		await app.workbench.databot.waitForResponseComplete();
		await app.workbench.console.waitForConsoleContents('second', { expectedCount: 2 });
	});

	test('Allow for session does not prompt again on next tool call', async function ({ app, sessions }) {
		await sessions.restart('Python');
		await app.workbench.databot.open();
		await app.workbench.databot.waitForReady();

		// First tool call - allow for session
		await app.workbench.databot.sendMessage('Print "first" in python', false);
		await app.workbench.databot.expectToolConfirmVisible();
		await app.workbench.databot.allowToolForSession();
		await app.workbench.databot.waitForResponseComplete();

		// Second tool call - should execute without prompting
		await app.workbench.databot.sendMessage('Print "second" in python', true, { newConversation: false });
		await app.workbench.console.waitForConsoleContents('second', { expectedCount: 2 });
	});

	test('Create data visualization via Databot', async function ({ app, sessions }) {
		await sessions.restart('R');
		await app.workbench.plots.clearPlots();
		await app.workbench.databot.open();
		await app.workbench.databot.waitForReady();

		await app.workbench.databot.sendMessage('Create a simple data visualization using base R plot()', false);
		await app.workbench.databot.expectToolConfirmVisible();
		await app.workbench.databot.allowToolForSession();
		await app.workbench.databot.waitForResponseComplete();

		// Verify plot appears inline in the Databot chat
		await app.workbench.databot.expectInlinePlotVisible();

		// Verify plot appears in the Positron plots pane
		await app.workbench.plots.waitForCurrentPlot();
	});

});
