/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { ModelProvider } from '../../pages/positronAssistant';

test.use({
	suiteId: __filename
});

const POSIT_ASSISTANT_PROVIDERS: ModelProvider[] = ['anthropic-api'];

test.describe('Posit Assistant', {
	tag: [tags.POSIT_ASSISTANT, tags.ASSISTANT, tags.WEB, tags.WIN],
}, () => {

	for (const provider of POSIT_ASSISTANT_PROVIDERS) {
		test.describe(provider, () => {
			test.beforeAll(async function ({ app }) {
				await app.workbench.assistant.loginModelProvider(provider);
				// Maximize the sidebar so the Posit Assistant webview is not
				// obscured by outer-page elements on small CI viewports.
				await app.workbench.quickaccess.runCommand('workbench.action.fullSizedSidebar');
			});

			test.afterAll(async function ({ app }) {
				await app.workbench.assistant.logoutModelProvider(provider);
			});

			test(`${provider} - Open Posit Assistant and verify welcome page`, async function ({ app }) {
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.expectWelcomeVisible();
			});

			test(`${provider} - Send a chat message and receive a response`, async function ({ app }) {
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();

				await app.workbench.positAssistant.sendMessage('Say hello', true, { newConversation: true });
				await app.workbench.positAssistant.expectResponseVisible();

				const responseText = await app.workbench.positAssistant.getLastResponseText();
				test.expect(responseText.length).toBeGreaterThan(0);
			});

			test(`${provider} - Execute Python code via Posit Assistant`, async function ({ app, sessions }) {
				const session = await sessions.start('python', { reuse: false });
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();

				await app.workbench.positAssistant.sendMessage('Print "hello world" in python', false);
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolOnce();
				await app.workbench.positAssistant.waitForResponseComplete();
				await app.workbench.console.waitForConsoleContents('hello world', { expectedCount: 2 });
				await sessions.delete(session.id);
			});

			test(`${provider} - Execute R code via Posit Assistant`, async function ({ app, sessions }) {
				const session = await sessions.start('r', { reuse: false });
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();

				await app.workbench.positAssistant.sendMessage('Print "hello world" in R', false);
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolOnce();
				await app.workbench.positAssistant.waitForResponseComplete();
				await app.workbench.console.waitForConsoleContents('hello world', { expectedCount: 2 });
				await sessions.delete(session.id);
			});

			test(`${provider} - Allow once prompts again on next tool call`, async function ({ app, sessions }) {
				const session = await sessions.start('python', { reuse: false });
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();

				// First tool call - allow once
				await app.workbench.positAssistant.sendMessage('Print "first" in python', false);
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolOnce();
				await app.workbench.positAssistant.waitForResponseComplete();

				// Second tool call - should prompt again
				await app.workbench.positAssistant.sendMessage('Print "second" in python', false, { newConversation: false });
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolOnce();
				await app.workbench.positAssistant.waitForResponseComplete();
				await app.workbench.console.waitForConsoleContents('second', { expectedCount: 2 });
				await sessions.delete(session.id);
			});

			test(`${provider} - Allow for session does not prompt again on next tool call`, async function ({ app, sessions }) {
				const session = await sessions.start('python', { reuse: false });
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();

				// First tool call - allow for session
				await app.workbench.positAssistant.sendMessage('Print "first" in python', false);
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolForSession();
				await app.workbench.positAssistant.waitForResponseComplete();

				// Second tool call - should execute without prompting
				await app.workbench.positAssistant.sendMessage('Print "second" in python', true, { newConversation: false });
				await app.workbench.console.waitForConsoleContents('second', { expectedCount: 2 });
				await sessions.delete(session.id);
			});

			test(`${provider} - Create data visualization via Posit Assistant`, async function ({ app, sessions }) {
				const session = await sessions.start('r', { reuse: false });
				await app.workbench.plots.clearPlots();
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();

				await app.workbench.positAssistant.sendMessage('Create a simple data visualization using base R plot()', false);
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolForSession();
				await app.workbench.positAssistant.waitForResponseComplete();

				// Verify plot appears inline in the chat
				await app.workbench.positAssistant.expectInlinePlotVisible();

				// Verify plot appears in the Positron plots pane
				await app.workbench.plots.waitForCurrentPlot();
				await sessions.delete(session.id);
			});
		});
	}

});
