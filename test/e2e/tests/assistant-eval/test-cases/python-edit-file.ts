/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { join } from 'path';
import { EvalTestCase } from '../types';

/**
 * Test: positron_editFile_internal tool usage
 *
 * Verifies that the positron_editFile_internal tool is called when
 * editing a file in Edit mode.
 */
const prompt = 'Add a method to return today\'s date.';
const mode = 'Edit';

export const pythonEditFile: EvalTestCase = {
	id: 'python-edit-file',
	description: 'Ensure editFile tool is called when editing files',
	prompt,
	mode,

	run: async ({ app, sessions, hotKeys, cleanup }) => {
		const { assistant, console, quickaccess } = app.workbench;

		// Start Python session
		const [pySession] = await sessions.start(['python']);

		// Setup: Open file
		await expect(async () => {
			await quickaccess.openFile(
				join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py')
			);
		}).toPass({ timeout: 5000 });

		// Ask the question (don't wait for response - we need to click Keep)
		await assistant.clickNewChatButton();
		await assistant.selectChatMode(mode);
		await assistant.enterChatMessage(
			prompt,
			false // Don't wait - we need to interact with Keep button
		);

		// Handle the Keep button interaction
		try {
			await assistant.clickKeepButton();
			await assistant.waitForResponseComplete();
		} catch (error) {
			// Keep button didn't appear or wasn't clickable - that's OK
		}

		// Get the response
		const response = await assistant.getChatResponseText(app.workspacePathOrFolder);

		// Cleanup
		await hotKeys.closeAllEditors();
		await console.focus();
		await sessions.restart(pySession.id);
		await cleanup.discardAllChanges();

		return response;
	},

	evaluationCriteria: {
		essential: [
			'The `positron_editFile_internal` tool must appear in the "Tools Called:" section',
			'Code uses a valid Python date approach (datetime module or similar)',
		],
		additional: [
			'Code is structured as a reusable method/function',
			'Method returns the date (not just prints it)',
			'Code includes appropriate imports (e.g., from datetime import date)',
		],
	},
};
