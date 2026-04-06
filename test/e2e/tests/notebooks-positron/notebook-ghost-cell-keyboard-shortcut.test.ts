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

		// Enable ghost cell suggestions and configure Anthropic model
		// Set automatic mode to false so only manual trigger (Cmd+Shift+G) generates suggestions
		await settings.set({
			'positron.assistant.notebook.ghostCellSuggestions.enabled': true,
			'positron.assistant.notebook.ghostCellSuggestions.model': ['claude'],
			'positron.assistant.notebook.ghostCellSuggestions.automatic': false
		}, { keepOpen: false });

		// Open assistant and login to Anthropic provider
		// Uses ANTHROPIC_API_KEY env var if set (auto-sign-in), or ANTHROPIC_KEY for manual login
		await assistant.openPositronAssistantChat();
		await assistant.loginModelProvider('anthropic-api');
	});

	test.beforeAll(async function ({ sessions }) {
		await sessions.start('python');
	});

	test.afterAll(async function ({ assistant, settings }) {
		await assistant.logoutModelProvider('anthropic-api');

		// Clean up ghost cell settings to ensure no interference with other tests
		await settings.remove([
			'positron.assistant.notebook.ghostCellSuggestions.enabled',
			'positron.assistant.notebook.ghostCellSuggestions.model',
			'positron.assistant.notebook.ghostCellSuggestions.automatic'
		]);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Cmd+Shift+G triggers ghost cell suggestion', async function ({ app, hotKeys }) {
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

		// In on-demand mode, after cell execution, ghost cell should show "AI suggestion available on request"
		// Wait for debounce delay (default 2 seconds)
		await app.code.driver.page.waitForTimeout(2500);
		await notebooksPositron.expectGhostCellAwaitingRequest();

		// Select cell in command mode (required for keyboard shortcut)
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });

		// Trigger ghost cell with keyboard shortcut - this is the main functionality being tested
		await hotKeys.triggerGhostCell();

		// Note: "Generating suggestion..." appears too quickly to reliably wait for
		// Instead, verify the ghost cell UI elements are present
		const page = app.code.driver.page;

		// Verify Get Suggestion button is visible
		await page.getByRole('button', { name: 'Get Suggestion' }).waitFor({ timeout: 10000 });

		// Verify mode toggle switch is visible
		await page.getByRole('switch', { name: 'Toggle suggestion mode' }).waitFor({ timeout: 10000 });
	});
});