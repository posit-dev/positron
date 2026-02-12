/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestTags } from '../../../infra';
import { EvalTestCase } from '../types';

/**
 * Test: Notebook automatic context (small notebook)
 *
 * TOOL: None (automatic context injection)
 * SCENARIO: Small notebooks (< 20 cells) have their content automatically
 *           included in the assistant's context without requiring tool calls.
 *
 * This test creates a 1-cell notebook with revenue data and asks the assistant
 * to calculate the total. The assistant should answer correctly using the
 * automatically-provided context, without calling getNotebookCells.
 */
const prompt = 'What is the total revenue shown in my notebook? Just tell me the answer, don\'t add or modify any cells.';
const mode = 'Edit';

export const rNotebookAutomaticContext: EvalTestCase = {
	id: 'r-notebook-automatic-context',
	description: 'Ensure small notebooks have automatic context without tool calls',
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

		// Add a cell that creates a data frame with specific data
		const code = `df <- data.frame(month = c('January', 'February', 'March'), revenue = c(45000, 52000, 48500), units_sold = c(150, 175, 162)); df`;
		await notebooksPositron.addCodeToCell(0, code);
		await notebooksPositron.runCodeAtIndex(0);
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);

		// Ask the question
		await assistant.clickNewChatButton();
		await assistant.selectChatMode(mode);
		await assistant.enterChatMessage(prompt, false);

		// Click allow button and get response
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
			'Correctly identifies the total revenue as 145,500 (sum of 45000 + 52000 + 48500)',
			'Response demonstrates the assistant can READ notebook contents by mentioning at least 2 of: specific revenue values (45000, 52000, 48500), months (January, February, March), or cell reference (cell 0)',
			'The `editNotebookCells` tool must NOT appear in "Tools Called:" (we asked NOT to edit)',
		],
		optional: [
			'References the DataFrame "df" by name or describes the data structure',
			'Provides a clear, accurate calculation or explanation showing how the total was derived',
			'Does not hallucinate columns or values not present in the notebook',
		],
	},
};
