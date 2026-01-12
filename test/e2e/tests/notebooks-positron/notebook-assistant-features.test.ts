/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Notebook Assistant Features', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.WEB]
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.beforeEach(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.setNotebookEditor(settings, 'positron');
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Notebook AI features hidden when assistant disabled', async function ({ app, settings, page }) {
		const { notebooks, notebooksPositron } = app.workbench;

		// Disable assistant features
		await settings.set({
			'positron.assistant.enable': false,
			'positron.assistant.notebookMode.enable': false
		});

		// Create a new notebook with a cell that produces an error
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');

		// Add a code cell with intentional error using proper pattern
		await notebooksPositron.addCodeToCell(0, 'invalid_function()', { run: true });

		// Wait for execution to complete
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);

		// Wait for error output to appear
		await page.waitForSelector('.notebook-error', { timeout: 10000 });

		// Verify Ask Assistant button is NOT visible in toolbar
		const askAssistantButton = page.getByRole('button', { name: 'Ask Assistant', exact: true });
		await expect(askAssistantButton).not.toBeVisible();

		// Verify Fix/Explain buttons are NOT visible in error cell
		const fixButton = page.getByRole('button', { name: /Ask assistant to fix/i });
		const explainButton = page.getByRole('button', { name: /Ask assistant to explain/i });
		await expect(fixButton).not.toBeVisible();
		await expect(explainButton).not.toBeVisible();
	});

	test('Notebook AI features visible when assistant enabled', async function ({ app, settings, page }) {
		const { notebooks, notebooksPositron, assistant, quickaccess } = app.workbench;

		// Enable assistant features (notebook mode requires master switch)
		await settings.set({
			'positron.assistant.enable': true,
			'positron.assistant.notebookMode.enable': true
		});

		// Configure and enable the echo model provider to set hasChatModels context key
		// This is required because the Fix/Explain buttons only show when a chat model is available
		await assistant.openPositronAssistantChat();
		await quickaccess.runCommand('positron-assistant.configureModels');
		await assistant.selectModelProvider('echo');
		await assistant.clickSignInButton();
		await assistant.clickCloseButton();

		// Create a new notebook with a cell that produces an error
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');

		// Add a code cell with intentional error using proper pattern
		await notebooksPositron.addCodeToCell(0, 'invalid_function()', { run: true });

		// Wait for execution to complete
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);

		// Wait for error output to appear
		await page.waitForSelector('.notebook-error', { timeout: 10000 });

		// Verify Ask Assistant button IS visible in toolbar
		const askAssistantButton = page.getByRole('button', { name: 'Ask Assistant', exact: true });
		await expect(askAssistantButton).toBeVisible();

		// Verify Fix/Explain buttons ARE visible in error cell
		const fixButton = page.getByRole('button', { name: /Ask assistant to fix/i });
		const explainButton = page.getByRole('button', { name: /Ask assistant to explain/i });
		await expect(fixButton).toBeVisible();
		await expect(explainButton).toBeVisible();
	});

	test('Follow Assistant toggle only visible when both assistant settings enabled', async function ({ app, settings, page }) {
		const { notebooks, notebooksPositron, assistant, quickaccess, hotKeys } = app.workbench;

		// Test 1: Disable assistant - Follow Assistant should not be visible
		await settings.set({
			'positron.assistant.enable': false,
			'positron.assistant.notebookMode.enable': false
		});

		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();

		// Follow Assistant has eye icon and toggles assistant auto-follow
		const followAssistantDisabled = page.getByRole('button', { name: /[Ff]ollow.*[Aa]ssistant/i });
		await expect(followAssistantDisabled).not.toBeVisible();

		// Close the notebook before changing settings
		await hotKeys.closeAllEditors();

		// Test 2: Enable master switch but not notebook mode - should still not be visible
		await settings.set({
			'positron.assistant.enable': true,
			'positron.assistant.notebookMode.enable': false
		});

		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();

		const followAssistantPartial = page.getByRole('button', { name: /[Ff]ollow.*[Aa]ssistant/i });
		await expect(followAssistantPartial).not.toBeVisible();

		// Close the notebook before changing settings
		await hotKeys.closeAllEditors();

		// Test 3: Enable both settings AND configure echo model (required for hasChatModels context key)
		await settings.set({
			'positron.assistant.enable': true,
			'positron.assistant.notebookMode.enable': true
		});

		// Configure and enable the echo model provider to set hasChatModels context key
		await assistant.openPositronAssistantChat();
		await quickaccess.runCommand('positron-assistant.configureModels');
		await assistant.selectModelProvider('echo');
		await assistant.clickSignInButton();
		await assistant.clickCloseButton();

		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();

		const followAssistantEnabled = page.getByRole('button', { name: /[Ff]ollow.*[Aa]ssistant/i });
		await expect(followAssistantEnabled).toBeVisible();
	});
});
