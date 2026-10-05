/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { PositAssistant } from '../../pages/positAssistant.js';

test.use({
	suiteId: __filename,
});

test.describe('Notebook Assistant: Feature Toggle', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.ASSISTANT, tags.WIN]
}, () => {

	test('Notebook AI features hidden when AI disabled', async function ({ app, settings }) {
		const { notebooksPositron } = app.workbench;

		// Turn off the AI main switch, which gates all of Positron's AI features
		await settings.set({ 'ai.enabled': false });

		// Create a new notebook
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.kernel.select('R');

		// Add a code cell with intentional error
		await notebooksPositron.addCodeToCell(0, 'invalid_function()', { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
		await notebooksPositron.expectNotebookErrorVisible();

		// Verify assistant buttons are NOT visible
		await notebooksPositron.expectAssistantButtonsVisible(false);
		await notebooksPositron.expectErrorAssistantButtonsVisible(false);
	});

	test('Notebook AI features visible when AI enabled', async function ({ app, settings }) {
		const { notebooksPositron, providerManager } = app.workbench;

		// Turn on the AI main switch and connect a provider so Posit Assistant has chat models
		await settings.set({ 'ai.enabled': true });
		await providerManager.loginModelProvider('anthropic');

		// Create a new notebook with a cell that produces an error
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.kernel.select('R');

		// Add a code cell with intentional error
		await notebooksPositron.addCodeToCell(0, 'invalid_function()', { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
		await notebooksPositron.expectNotebookErrorVisible();

		// Verify assistant buttons ARE visible
		await notebooksPositron.expectAssistantButtonsVisible(true);
		await notebooksPositron.expectErrorAssistantButtonsVisible(true);
		await providerManager.logoutModelProvider('anthropic');
	});
});

/**
 * The Fix and Explain buttons submit right away, so pick the model first. Call this last before
 * clicking, since it leaves keyboard focus in the chat input where shortcuts don't reach the workbench.
 */
async function selectAnthropicModel(positAssistant: PositAssistant) {
	await positAssistant.open();
	await positAssistant.waitForReady();
	await positAssistant.startNewConversation();
	await positAssistant.selectProviderModel('anthropic');
}

test.describe('Notebook Assistant: Interaction Flow', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.ASSISTANT, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll(async function ({ app }) {
		await app.workbench.providerManager.loginModelProvider('anthropic');
	});

	test.afterAll(async function ({ app }) {
		await app.workbench.providerManager.logoutModelProvider('anthropic');
	});

	test('Fix error button opens chat and sends error context', async function ({ app }) {
		const { notebooksPositron, positAssistant } = app.workbench;

		// Create notebook
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.kernel.select('Python');

		// Add a valid cell first
		await notebooksPositron.addCodeToCell(0, 'x = 10', { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);

		// Add a cell with an error and run it
		await notebooksPositron.addCodeToCell(1, 'result = x + undefined_var', { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 1, order: 2 }]);
		await notebooksPositron.expectNotebookErrorVisible();

		// Pick the model, then click the Fix button
		await selectAnthropicModel(positAssistant);
		await notebooksPositron.clickFixErrorButton();
		await positAssistant.expectViewOpen();
		await positAssistant.expectChatContainsText('Fix this notebook cell error.');

		// Verify the reply is about the error that was sent. Poll the text since the model may stop at a tool confirmation
		await expect.poll(() => positAssistant.getLastResponseText(), { timeout: 60000 }).toContain('undefined_var');
	});

	test('Explain error button opens chat and sends error context', async function ({ app }) {
		const { notebooksPositron, positAssistant } = app.workbench;

		// Create notebook
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.kernel.select('Python');

		// Add a cell with an error and run it
		await notebooksPositron.addCodeToCell(0, 'undefined_function()', { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
		await notebooksPositron.expectNotebookErrorVisible();

		// Pick the model, then click the Explain button
		await selectAnthropicModel(positAssistant);
		await notebooksPositron.clickExplainErrorButton();
		await positAssistant.expectViewOpen();
		await positAssistant.expectChatContainsText('Explain this notebook cell error.');

		// Verify the reply is about the error that was sent
		await expect.poll(() => positAssistant.getLastResponseText(), { timeout: 60000 }).toContain('undefined_function');
	});
});
