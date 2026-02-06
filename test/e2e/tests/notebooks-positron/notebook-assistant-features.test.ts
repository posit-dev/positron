/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook Assistant: Feature Toggle', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.ASSISTANT]
}, () => {

	test('Notebook AI features hidden when assistant disabled', async function ({ app, settings }) {
		const { notebooksPositron } = app.workbench;

		// Disable assistant features
		await settings.set({ 'positron.assistant.enable': false });

		// Create a new notebook with a cell that produces an error
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.kernel.select('Python');

		// Add a code cell with intentional error
		await notebooksPositron.addCodeToCell(0, 'invalid_function()', { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
		await notebooksPositron.expectNotebookErrorVisible();

		// Verify assistant buttons are NOT visible
		await notebooksPositron.expectAssistantButtonsVisible(false);
		await notebooksPositron.expectErrorAssistantButtonsVisible(false);
	});

	test('Notebook AI features visible when assistant enabled', async function ({ app, settings }) {
		const { notebooksPositron, assistant } = app.workbench;

		// Enable assistant and sign in to echo provider
		await settings.set({ 'positron.assistant.enable': true });
		await assistant.signInToProvider('echo');

		// Create a new notebook with a cell that produces an error
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.kernel.select('Python');

		// Add a code cell with intentional error
		await notebooksPositron.addCodeToCell(0, 'invalid_function()', { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
		await notebooksPositron.expectNotebookErrorVisible();
		// Verify assistant buttons ARE visible
		await notebooksPositron.expectAssistantButtonsVisible(true);
		await notebooksPositron.expectErrorAssistantButtonsVisible(true);
	});
});

test.describe('Notebook Assistant: Interaction Flow', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.ASSISTANT]
}, () => {

	test.beforeAll(async function ({ assistant }) {
		await assistant.signInToProvider('echo');
	});

	test.afterAll(async function ({ assistant }) {
		await assistant.signOutFromProvider('echo');
	});

	test('Fix error button opens chat and sends error context', async function ({ app }) {
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
	});

	test('Explain error button opens chat and sends error context', async function ({ app }) {
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
	});
});
