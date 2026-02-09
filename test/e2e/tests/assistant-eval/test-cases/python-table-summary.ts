/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { join } from 'path';
import { EvalTestCase } from './types';

/**
 * Test: getTableSummary tool usage
 *
 * Verifies that the getTableSummary tool is called when summarizing
 * a dataframe in Ask mode.
 */
const prompt = 'Summarize my table df.';
const mode = 'Ask';

export const pythonTableSummary: EvalTestCase = {
	id: 'python-table-summary',
	description: 'Ensure getTableSummary tool is called when summarizing data in Ask mode',
	prompt,
	mode,

	run: async ({ app, sessions, hotKeys, cleanup }) => {
		const { assistant, console, quickaccess } = app.workbench;

		// Start Python session
		const [pySession] = await sessions.start(['python']);

		// Setup: Open file and execute it
		await expect(async () => {
			await quickaccess.openFile(
				join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py')
			);
			await quickaccess.runCommand('python.execInConsole');
		}).toPass({ timeout: 5000 });

		// Ask the question
		await assistant.clickNewChatButton();
		await assistant.selectChatMode(mode);
		await assistant.enterChatMessage(prompt, true);
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
			'The `getTableSummary` tool must appear in the `Tools Called:` section',
		],
		additional: [
			'Summary includes column names from the dataframe',
			'Summary includes data types',
			'Summary includes basic statistics (row count, null counts, or descriptive stats)',
			'Summary is presented clearly and accurately reflects the table data',
		],
	},
};
