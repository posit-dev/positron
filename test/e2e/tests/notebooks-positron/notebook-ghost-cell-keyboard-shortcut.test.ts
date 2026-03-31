/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook: Ghost Cell Keyboard Shortcut', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings, assistant }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);

		// Enable ghost cell suggestions and configure echo model
		await settings.set({
			'positron.assistant.notebook.ghostCellSuggestions.enabled': true,
			'positron.assistant.notebook.ghostCellSuggestions.model': ['echo']
		}, { keepOpen: false });

		// Login to echo provider
		await assistant.loginModelProvider('echo');
	});

	test.afterAll(async function ({ assistant, settings }) {
		await assistant.logoutModelProvider('echo');

		// Clean up ghost cell settings to ensure no interference with other tests
		await settings.remove([
			'positron.assistant.notebook.ghostCellSuggestions.enabled',
			'positron.assistant.notebook.ghostCellSuggestions.model'
		]);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Ghost cell workflow: Automatic mode to On-demand mode with Accept and Run', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// Create notebook - Positron will auto-select an available kernel
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.expectToBeVisible();

		// Wait for kernel to be ready
		await app.code.driver.page.waitForTimeout(5000);

		// Add and execute a simple cell to provide context for ghost cell suggestions
		// Using comment which works in both Python and R
		await notebooksPositron.addCodeToCell(0, '# context', { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);

		// Select cell in command mode (required for keyboard shortcut)
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });

		// Trigger ghost cell with keyboard shortcut
		await hotKeys.triggerGhostCell();

		// Verify "Generating suggestion..." appears
		await notebooksPositron.expectGhostCellGenerationVisible();

		// Wait for ghost cell to appear and verify all components
		await notebooksPositron.expectGhostCellVisible();

		// Verify default mode is Automatic
		await notebooksPositron.expectGhostCellMode(true);

		// Switch to On-demand mode
		await notebooksPositron.selectGhostCellMode(false);
		// Note: selectGhostCellMode already verifies the mode was selected

		// Accept and Run the suggestion
		await notebooksPositron.acceptGhostCellSuggestion();

		// Verify cell is generated and executed (cell count increases from 1 to 2)
		await notebooksPositron.expectCellCountToBe(2);

		// Verify "AI suggestion available on request" appears for On-demand mode
		await notebooksPositron.expectGhostCellAwaitingRequest();

		// Request a suggestion to trigger generation again
		await notebooksPositron.getSuggestion();

		// Verify "Generating suggestion..." appears again
		await notebooksPositron.expectGhostCellGenerationVisible();
	});
});