/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { ModelProvider } from '../../pages/positronAssistant';

test.use({
	suiteId: __filename
});

const DATABOT_PROVIDERS: ModelProvider[] = ['anthropic-api'];

test.describe('Databot', {
	tag: [tags.ASSISTANT, tags.DATABOT, tags.WEB, tags.WIN, tags.SOFT_FAIL],
}, () => {

	test.beforeAll(async function ({ app }) {
		await app.workbench.extensions.installExtension('posit.databot', true);
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.hotKeys.closeAllEditors();
	});

	for (const provider of DATABOT_PROVIDERS) {
		test.describe(provider, () => {
			test.beforeAll(async function ({ app }) {
				await app.workbench.assistant.loginModelProvider(provider);
			});

			test.afterAll(async function ({ app }) {
				await app.workbench.assistant.logoutModelProvider(provider);
			});

			test(`${provider} - Execute Python code via Databot`, async function ({ app, sessions }) {
				const session = await sessions.start('python', { reuse: false });
				await app.workbench.databot.open();
				await app.workbench.databot.waitForReady();

				await app.workbench.databot.sendMessage('Print "hello world" in python', false);
				await app.workbench.databot.expectToolConfirmVisible();
				await app.workbench.databot.allowToolOnce();
				await app.workbench.databot.waitForResponseComplete();
				await app.workbench.console.waitForConsoleContents('hello world', { expectedCount: 2 });
				await sessions.delete(session.id);
			});

			test(`${provider} - Execute R code via Databot`, async function ({ app, sessions }) {
				const session = await sessions.start('r', { reuse: false });
				await app.workbench.databot.open();
				await app.workbench.databot.waitForReady();

				await app.workbench.databot.sendMessage('Print "hello world" in R', false);
				await app.workbench.databot.expectToolConfirmVisible();
				await app.workbench.databot.allowToolOnce();
				await app.workbench.databot.waitForResponseComplete();
				await app.workbench.console.waitForConsoleContents('hello world', { expectedCount: 2 });
				await sessions.delete(session.id);
			});

			test(`${provider} - Allow once prompts again on next tool call`, async function ({ app, sessions }) {
				const session = await sessions.start('python', { reuse: false });
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
				await sessions.delete(session.id);
			});

			test(`${provider} - Allow for session does not prompt again on next tool call`, async function ({ app, sessions }) {
				const session = await sessions.start('python', { reuse: false });
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
				await sessions.delete(session.id);
			});

			test(`${provider} - Create data visualization via Databot`, async function ({ app, sessions }) {
				const session = await sessions.start('r', { reuse: false });
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
				await sessions.delete(session.id);
			});
		});
	}

});
