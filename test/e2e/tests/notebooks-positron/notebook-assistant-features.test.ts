/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename,
});

// The Fix/Explain buttons and the Ask Assistant action only render once Posit
// Assistant reports a usable chat model, so a real provider has to be connected
// for the "visible" cases; the echo test provider is gone.
const PROVIDER = 'anthropic-api';

test.describe('Notebook Assistant: Feature Toggle', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.ASSISTANT, tags.WIN]
}, () => {

	test.beforeAll(async function ({ app }) {
		await app.workbench.modelProviderModal.loginModelProvider(PROVIDER);
	});

	test.afterAll(async function ({ app, settings }) {
		await settings.remove(['ai.enabled']);
		await app.workbench.modelProviderModal.logoutModelProvider(PROVIDER);
	});

	test('Notebook AI features hidden when AI disabled', { tag: [tags.ARK] }, async function ({ app, settings }) {
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

	test('Notebook AI features visible when AI enabled', { tag: [tags.ARK] }, async function ({ app, settings }) {
		const { notebooksPositron } = app.workbench;

		// Turn on the AI main switch
		await settings.set({ 'ai.enabled': true });

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
	});
});

test.describe('Notebook Assistant: Interaction Flow', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.ASSISTANT, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll(async function ({ app }) {
		const { modelProviderModal, positAssistant } = app.workbench;
		await modelProviderModal.loginModelProvider(PROVIDER);
		// Open the chat once up front: newChat against a webview that has never
		// rendered submits before the model catalog has loaded and is rejected with
		// "No model selected" (posit-dev/assistant#2646).
		await positAssistant.open();
		await positAssistant.waitForReady();
	});

	test.afterAll(async function ({ app }) {
		await app.workbench.modelProviderModal.logoutModelProvider(PROVIDER);
	});

	test('Fix error button opens chat and sends error context', { tag: [tags.PYTHON] }, async function ({ app }) {
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

		// Click the Fix button and wait for the response, allowing any tool the
		// model asks for on the way
		await notebooksPositron.clickFixErrorButton();
		await positAssistant.expectViewOpen();
		await positAssistant.waitForResponseCompleteAllowingTools();

		// Verify the prompt and the error attachment were sent. The response text is
		// not inspected: the provider's content filter sometimes refuses the Fix
		// prompt, and the attachment already proves the error context went out.
		await positAssistant.expectUserMessageToContainText('Fix this notebook cell error.');
		await positAssistant.expectUserMessageToContainText('Notebook Cell Error');
		await positAssistant.expectResponseVisible();
		expect((await positAssistant.getLastResponseText()).length).toBeGreaterThan(0);
	});

	test('Explain error button opens chat and sends error context', { tag: [tags.PYTHON] }, async function ({ app }) {
		const { notebooksPositron, positAssistant } = app.workbench;

		// Create notebook
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.kernel.select('Python');

		// Add a cell with an error and run it
		await notebooksPositron.addCodeToCell(0, 'undefined_function()', { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
		await notebooksPositron.expectNotebookErrorVisible();

		// Click the Explain button and wait for the response
		await notebooksPositron.clickExplainErrorButton();
		await positAssistant.expectViewOpen();
		await positAssistant.waitForResponseCompleteAllowingTools();

		// Verify the prompt and the error attachment were sent
		await positAssistant.expectUserMessageToContainText('Explain this notebook cell error.');
		await positAssistant.expectUserMessageToContainText('Notebook Cell Error');
		await positAssistant.expectResponseVisible();
		expect((await positAssistant.getLastResponseText()).length).toBeGreaterThan(0);
	});
});
