/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestTags } from '../../../infra';
import { EvalTestCase } from '../types';

/**
 * Test: getNotebookCells tool (large notebook)
 *
 * TOOL: getNotebookCells
 * SCENARIO: Large notebooks (>= 20 cells) use a sliding window for automatic context.
 *           Cells outside the window require an explicit getNotebookCells tool call.
 *
 * This test creates a 21-cell notebook where each cell calculates `x * 10`.
 * Cell 0 is selected, so cell 20 is outside the automatic context window.
 * When asked about cell 20, the assistant MUST call getNotebookCells to fetch it.
 */
const prompt = 'What is the value calculated in cell 20 of my notebook?';
const mode = 'Edit';

export const rNotebookGetCells: EvalTestCase = {
	id: 'r-notebook-get-cells',
	description: 'Ensure getNotebookCells is called for large notebooks',
	prompt,
	mode,
	tags: [TestTags.POSITRON_NOTEBOOKS, TestTags.ARK],

	run: async ({ app, hotKeys, cleanup, settings }) => {
		const { assistant, notebooksPositron } = app.workbench;

		// Enable Positron notebooks
		await notebooksPositron.enablePositronNotebooks(settings);

		// Create a new notebook and select R kernel
		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('R');

		// Create 21 cells (indices 0-20) so it's a "large" notebook
		for (let i = 0; i < 21; i++) {
			const code = `x <- ${i}; result_${i} <- x * 10; result_${i}`;
			await notebooksPositron.addCodeToCell(i, code);
			await notebooksPositron.runCodeAtIndex(i);
			await notebooksPositron.expectExecutionOrder([{ index: i, order: i + 1 }]);
		}

		// Select cell 0 so the sliding window is at the beginning
		// This ensures cell 20 is outside the automatic context window
		await notebooksPositron.selectCellAtIndex(0);

		// Ask the question
		await assistant.clickNewChatButton();
		await assistant.selectChatMode(mode);
		await assistant.enterChatMessage(prompt, false);

		// Allow tools and get response
		await assistant.clickAllowButton();
		await assistant.expectResponseComplete();
		const response = await assistant.getChatResponseText(app.workspacePathOrFolder);

		// Cleanup
		await hotKeys.closeAllEditors();
		await cleanup.discardAllChanges();

		return response;
	},

	evaluationCriteria: {
		required: [
			'The `getNotebookCells` tool must appear in the "Tools Called:" section (required because large notebooks use sliding window)',
			'Reports the correct value from cell 20 (which is 200, since it calculates x * 10 where x = 20)',
		],
		optional: [
			'Explains what the code does or references the calculation',
			'Does not hallucinate values from cells that don\'t exist',
			'Correctly identifies cell 20 (0-indexed: cell index 19)',
		],
	},
};
