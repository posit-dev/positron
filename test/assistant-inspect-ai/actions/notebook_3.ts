/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { SampleActions } from './types';

/**
 * Notebook 3: editNotebookCells Tool
 *
 * TOOL: editNotebookCells
 * SCENARIO: When editing notebook cells, the assistant should use editNotebookCells
 *           (not editFile) to modify the cell content.
 *
 * This test creates a 2-cell notebook with an intentional R error in cell 2
 * (references undefined_variable). When asked to fix the error, the assistant
 * MUST call editNotebookCells to modify the cell, NOT editFile.
 */
export const actions: SampleActions = {
	setup: async (ctx) => {
		await ctx.settings.set({ 'positron.notebook.enabled': true }, { reload: 'web' });

		const { notebooksPositron } = ctx.app.workbench;

		// Create a new notebook and select R kernel
		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('R');

		// Add a valid cell first to establish context
		await notebooksPositron.addCodeToCell(0, 'x <- 10', { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);

		// Add a cell with an intentional error (single line to avoid auto-indent issues)
		const errorCode = `result <- x + undefined_variable`;
		await notebooksPositron.addCodeToCell(1, errorCode, { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 1, order: 2 }]);
	},

	postQuestion: async (ctx) => {
		const { assistant } = ctx.app.workbench;

		// In Edit mode, the assistant needs permission to use tools like editNotebookCells
		await assistant.clickAllowButton();
		await assistant.expectResponseComplete();

		// If the assistant suggests edits, accept them
		try {
			await assistant.clickKeepButton();
		} catch {
			// Keep button didn't appear or wasn't clickable - that's OK
		}
	},

	cleanup: async (ctx) => {
		await ctx.hotKeys.closeAllEditors();
		await ctx.cleanup.discardAllChanges();
	},
};
