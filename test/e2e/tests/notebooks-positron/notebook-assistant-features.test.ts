/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
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

	test.skip('Notebook AI features visible when AI enabled', async function ({ app, settings }) {
		const { notebooksPositron, assistant } = app.workbench;

		// Turn on the AI main switch, enable the assistant, and sign in to echo provider
		await settings.set({ 'ai.enabled': true, 'positron.assistant.enable': true });
		await assistant.loginModelProvider('echo');

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
		await assistant.logoutModelProvider('echo');
	});
});

test.describe.skip('Notebook Assistant: Interaction Flow', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.ASSISTANT, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll(async function ({ assistant }) {
		await assistant.loginModelProvider('echo');
	});

	test.afterAll(async function ({ assistant }) {
		await assistant.logoutModelProvider('echo');
	});

	test.skip('Fix error button opens chat and sends error context', async function ({ app }) {
		const { notebooksPositron, assistant } = app.workbench;

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

		// Click the Fix button and wait for response
		await notebooksPositron.clickFixErrorButton();
		await assistant.waitForResponseComplete();

		// Verify the chat panel is visible and received a response
		await assistant.expectChatPanelVisible();
		await assistant.expectChatResponseVisible();

		// Verify the error context was sent
		const responseText = await assistant.getChatResponseText(app.workspacePathOrFolder);
		expect(responseText).toContain('undefined_var');
	});

	test.skip('Explain error button opens chat and sends error context', async function ({ app }) {
		const { notebooksPositron, assistant } = app.workbench;

		// Create notebook
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.kernel.select('Python');

		// Add a cell with an error and run it
		await notebooksPositron.addCodeToCell(0, 'undefined_function()', { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
		await notebooksPositron.expectNotebookErrorVisible();

		// Click the Explain button and wait for response
		await notebooksPositron.clickExplainErrorButton();
		await assistant.waitForResponseComplete();

		// Verify the chat panel is visible and received a response
		await assistant.expectChatPanelVisible();
		await assistant.expectChatResponseVisible();

		// Verify the error context was sent
		const responseText = await assistant.getChatResponseText(app.workspacePathOrFolder);
		expect(responseText).toContain('undefined_function');
	});
});
