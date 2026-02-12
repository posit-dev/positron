/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestTags } from '../../../infra';
import { EvalTestCase } from '../types';

/**
 * Test: runNotebookCells tool
 *
 * TOOL: runNotebookCells
 * SCENARIO: When asked to execute notebook cells, the assistant should use
 *           runNotebookCells to run the code. Requires Agent mode.
 *
 * This test creates a 2-cell notebook with R code (x <- 10 and x + 5).
 * When asked to run cell 2, the assistant MUST call runNotebookCells
 * and report the output (15).
 */
const prompt = 'Run cell 2 of my notebook and tell me what the output is.';
const mode = 'Agent';

export const rNotebookRunCells: EvalTestCase = {
	id: 'r-notebook-run-cells',
	description: 'Ensure runNotebookCells is used to execute notebook cells',
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

		// Add a cell with code and run it to establish variable x
		const code = `x <- 10`;
		await notebooksPositron.addCodeToCell(0, code);
		await notebooksPositron.runCodeAtIndex(0);
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);

		// Add a second cell that uses x - run it once so it exists with content
		// We'll ask the assistant to run it (even if already run, runNotebookCells should still be called)
		const code2 = `result <- x + 5; print(result)`;
		await notebooksPositron.addCodeToCell(1, code2);
		await notebooksPositron.runCodeAtIndex(1);
		await notebooksPositron.expectExecutionOrder([{ index: 1, order: 2 }]);

		// Ask the question
		await assistant.clickNewChatButton();
		await assistant.selectChatMode(mode);
		await assistant.enterChatMessage(prompt, false);

		// Allow tools and get response
		await assistant.clickAllowButton();
		await assistant.waitForResponseComplete();
		const response = await assistant.getChatResponseText(app.workspacePathOrFolder);

		// Cleanup
		await hotKeys.closeAllEditors();
		await cleanup.discardAllChanges();

		return response;
	},

	evaluationCriteria: {
		required: [
			'The `runNotebookCells` tool must appear in the "Tools Called:" section',
			'Reports the correct output value (15, since x=10 and the code is result <- x + 5)',
		],
		optional: [
			'Explains what the code does (adds x + 5 where x is 10)',
			'Confirms the cell was executed successfully',
			'Does not use editNotebookCells when only asked to run (should use runNotebookCells)',
		],
	},
};
