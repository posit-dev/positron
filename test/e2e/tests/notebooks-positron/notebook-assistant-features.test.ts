/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook Assistant Features', {
	tag: [tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Notebook AI features hidden when assistant disabled', async function ({ app, settings, page }) {
		const { notebooks, notebooksPositron } = app.workbench;

		// Disable assistant features
		await settings.set({
			'positron.assistant.enable': false,
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
		const { notebooks, notebooksPositron, assistant } = app.workbench;

		// Enable assistant features (notebook mode requires master switch)
		await settings.set({
			'positron.assistant.enable': true,
		});

		// Configure and enable the echo model provider to set hasChatModels context key
		// This is required because the Fix/Explain buttons only show when a chat model is available
		await assistant.openPositronAssistantChat();
		await assistant.runConfigureProviders();
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
});
