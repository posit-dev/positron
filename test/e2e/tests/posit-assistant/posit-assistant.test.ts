/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { ModelProvider } from '../../pages/modelProviderShared';

test.use({
	suiteId: __filename,
});

const POSIT_ASSISTANT_PROVIDERS: ModelProvider[] = ['anthropic'];

test.describe('Posit Assistant', {
	tag: [tags.ASSISTANT, tags.WEB, tags.WIN, tags.PLOTS],
}, () => {

	for (const provider of POSIT_ASSISTANT_PROVIDERS) {
		test.describe(provider, () => {
			// The tool-call tests set Normal; leave the product default behind.
			test.afterAll(async function ({ app }) {
				await app.workbench.positAssistant.setApprovalMode('auto').catch(() => { });
			});

			test.beforeAll(async function ({ app, settings }) {
				// Ensure we're running the latest Posit Assistant dev build.
				// Enables the auto dev-build update check, triggers the check,
				// and accepts the resulting "Update Now" / "Reload" toasts.
				//
				// This must run before sign-in. With the key already saved, the
				// reload makes the assistant check credentials while the new
				// extension host is still starting; on web that check can exceed
				// the assistant's 500ms cap, and the provider is then cached with
				// no models, so the model picker never renders. Signing in after
				// the reload is a credentials change on a running host, which
				// forces a fresh model listing.
				await app.workbench.positAssistant.checkForDevBuildUpdate(settings, app.workbench.quickaccess);
				await app.workbench.providerManager.loginModelProvider(provider);
				// Maximize the sidebar so the Posit Assistant webview is not
				// obscured by outer-page elements on small CI viewports.
				await app.workbench.quickaccess.runCommand('workbench.action.fullSizedSidebar');
			});

			test(`${provider} - Open Posit Assistant and verify welcome page`, async function ({ app }) {
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				// Posit Assistant persists client state (including the active
				// conversation) in a file store shared machine-wide (assistant#1888,
				// wave-2 conversation substrate), so a fresh Positron instance
				// restores the last conversation left by ANY earlier suite on the
				// same runner (e.g. the sign-in suite's "Say hello" chats) instead
				// of showing the welcome page. Start a fresh conversation first so
				// the landing page renders deterministically.
				// See https://github.com/posit-dev/positron/issues/15187
				await app.workbench.positAssistant.startNewConversation();
				await app.workbench.positAssistant.expectWelcomeVisible();
			});

			test(`${provider} - Send a chat message and receive a response`, async function ({ app }) {
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.startNewConversation();
				await app.workbench.positAssistant.selectProviderModel(provider);

				await app.workbench.positAssistant.sendMessage('Say hello', true, { newConversation: false });
				await app.workbench.positAssistant.expectResponseVisible();

				const responseText = await app.workbench.positAssistant.getLastResponseText();
				test.expect(responseText.length).toBeGreaterThan(0);
			});

			test(`${provider} - Execute Python code via Posit Assistant`, { tag: [tags.PYTHON] }, async function ({ app, sessions }) {
				const session = await sessions.start('python', { reuse: false });
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.startNewConversation();
				await app.workbench.positAssistant.selectProviderModel(provider);
				await app.workbench.positAssistant.setApprovalMode('normal');

				await app.workbench.positAssistant.sendMessage('Print "hello world" in python', false, { newConversation: false });
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolOnce();
				await app.workbench.positAssistant.waitForResponseComplete();
				await app.workbench.console.waitForConsoleContents('hello world', { expectedCount: 2 });
				await sessions.delete(session.id);
			});

			test(`${provider} - Execute R code via Posit Assistant`, { tag: [tags.ARK] }, async function ({ app, sessions }) {
				const session = await sessions.start('r', { reuse: false });
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.startNewConversation();
				await app.workbench.positAssistant.selectProviderModel(provider);
				await app.workbench.positAssistant.setApprovalMode('normal');

				await app.workbench.positAssistant.sendMessage('Print "hello world" in R', false, { newConversation: false });
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolOnce();
				await app.workbench.positAssistant.waitForResponseComplete();
				await app.workbench.console.waitForConsoleContents('hello world', { expectedCount: 2 });
				await sessions.delete(session.id);
			});

			test(`${provider} - Allow once prompts again on next tool call`, { tag: [tags.PYTHON] }, async function ({ app, sessions }) {
				const session = await sessions.start('python', { reuse: false });
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.startNewConversation();
				await app.workbench.positAssistant.selectProviderModel(provider);
				await app.workbench.positAssistant.setApprovalMode('normal');

				// First tool call - allow once
				await app.workbench.positAssistant.sendMessage('Print "first" in python', false, { newConversation: false });
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

			test(`${provider} - Allow for session does not prompt again on next tool call`, { tag: [tags.PYTHON] }, async function ({ app, sessions }) {
				const session = await sessions.start('python', { reuse: false });
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.startNewConversation();
				await app.workbench.positAssistant.selectProviderModel(provider);
				await app.workbench.positAssistant.setApprovalMode('normal');

				// First tool call - allow for session
				await app.workbench.positAssistant.sendMessage('Print "first" in python', false, { newConversation: false });
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolForSession();
				await app.workbench.positAssistant.waitForResponseComplete();

				// Second tool call - should execute without prompting
				await app.workbench.positAssistant.sendMessage('Print "second" in python', true, { newConversation: false });
				await app.workbench.console.waitForConsoleContents('second', { expectedCount: 2 });
				await sessions.delete(session.id);
			});

			test(`${provider} - Create data visualization via Posit Assistant`, { tag: [tags.ARK] }, async function ({ app, sessions }) {
				const session = await sessions.start('r', { reuse: false });
				await app.workbench.plots.clearPlots();
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.startNewConversation();
				await app.workbench.positAssistant.selectProviderModel(provider);
				await app.workbench.positAssistant.setApprovalMode('normal');

				await app.workbench.positAssistant.sendMessage('Create a simple data visualization using base R plot()', false, { newConversation: false });
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolForSession();
				await app.workbench.positAssistant.waitForResponseComplete();

				// Verify plot appears inline in the chat and has real content
				await app.workbench.positAssistant.expectInlinePlotVisible();
				await app.workbench.positAssistant.expectInlinePlotNotBlank();

				// Verify plot appears in the Positron plots pane
				await app.workbench.plots.waitForCurrentPlot();
				await sessions.delete(session.id);
			});

			test(`${provider} - Create data visualization via Posit Assistant (Python)`, { tag: [tags.PYTHON] }, async function ({ app, sessions }) {
				const session = await sessions.start('python', { reuse: false });
				await app.workbench.plots.clearPlots();
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.startNewConversation();
				await app.workbench.positAssistant.selectProviderModel(provider);
				await app.workbench.positAssistant.setApprovalMode('normal');

				await app.workbench.positAssistant.sendMessage('Create a simple data visualization using matplotlib', false, { newConversation: false });
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolForSession();
				await app.workbench.positAssistant.waitForResponseComplete();

				// Verify plot appears inline in the chat and has real content
				await app.workbench.positAssistant.expectInlinePlotVisible();
				await app.workbench.positAssistant.expectInlinePlotNotBlank();

				// Verify plot appears in the Positron plots pane
				await app.workbench.plots.waitForCurrentPlot();
				await sessions.delete(session.id);
			});
		});
	}

});
