/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestTags } from '../../../infra';
import { EvalTestCase } from '../types';

/**
 * Test: editNotebookCells tool
 *
 * TOOL: editNotebookCells
 * SCENARIO: When editing notebook cells, the assistant should use editNotebookCells
 *           (not editFile) to modify the cell content.
 *
 * This test creates a 2-cell notebook with an intentional R error in cell 2
 * (references undefined_variable). When asked to fix the error, the assistant
 * MUST call editNotebookCells to modify the cell, NOT editFile.
 */
const prompt = 'Fix the error in cell 2 of my notebook.';
const mode = 'Edit';

export const rNotebookEditCells: EvalTestCase = {
	id: 'r-notebook-edit-cells',
	description: 'Ensure editNotebookCells is used when editing notebook cells',
	prompt,
	mode,
	tags: [TestTags.POSITRON_NOTEBOOKS, TestTags.ARK],

	run: async ({ app, sessions, hotKeys, cleanup, settings }) => {
		const { assistant, notebooksPositron, console } = app.workbench;

		// Enable Positron notebooks
		await notebooksPositron.enablePositronNotebooks(settings);

		// Start R session
		const [rSession] = await sessions.start(['r']);

		// Create a new notebook and select R kernel
		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('R');

		// Add a valid cell first to establish context
		await notebooksPositron.addCodeToCell(0, 'x <- 10');
		await notebooksPositron.runCodeAtIndex(0);
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);

		// Add a cell with an intentional error (single line to avoid auto-indent issues)
		const errorCode = `result <- x + undefined_variable`;
		await notebooksPositron.addCodeToCell(1, errorCode);
		await notebooksPositron.runCodeAtIndex(1);
		await notebooksPositron.expectExecutionOrder([{ index: 1, order: 2 }]);

		// Ask the question
		await assistant.clickNewChatButton();
		await assistant.selectChatMode(mode);
		await assistant.enterChatMessage(prompt, false);

		// In Edit mode, the assistant needs permission to use tools like editNotebookCells
		await assistant.clickAllowButton();
		await assistant.waitForResponseComplete();

		// If the assistant suggests edits, accept them
		try {
			await assistant.clickKeepButton();
		} catch {
			// Keep button didn't appear or wasn't clickable - that's OK
		}

		const response = await assistant.getChatResponseText(app.workspacePathOrFolder);

		// Cleanup
		await hotKeys.closeAllEditors();
		await console.focus();
		await sessions.restart(rSession.id);
		await cleanup.discardAllChanges();

		return response;
	},

	evaluationCriteria: {
		essential: [
			'The `editNotebookCells` tool must appear in the "Tools Called:" section',
			'The `editFile` or `positron_editFile_internal` tool must NOT appear (wrong tool for notebooks)',
		],
		additional: [
			'Correctly identifies the R error (object "undefined_variable" not found)',
			'Provides a reasonable fix (define the variable, use a different value, or remove the reference)',
			'Fix is applied to the correct cell (cell index 1, which is the second cell)',
			'Explanation of what was wrong and how it was fixed',
		],
		failIf: [
			'Uses editFile instead of editNotebookCells (indicates the assistant did not correctly identify the notebook context)',
		],
	},
};
