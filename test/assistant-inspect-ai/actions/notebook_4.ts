/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { SampleActions } from './types';

/**
 * Notebook 4: runNotebookCells Tool
 *
 * TOOL: runNotebookCells
 * SCENARIO: When asked to execute notebook cells, the assistant should use
 *           runNotebookCells to run the code. Requires Agent mode.
 *
 * This test creates a 2-cell notebook with R code (x <- 10 and x + 5).
 * When asked to run cell 2, the assistant MUST call runNotebookCells
 * and report the output (15).
 */
export const actions: SampleActions = {
	setup: async (ctx) => {
		await ctx.settings.set({ 'positron.notebook.enabled': true }, { reload: 'web' });
		const { notebooksPositron } = ctx.app.workbench;

		// Create a new notebook and select R kernel
		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('R');

		// Add a cell with code and run it to establish variable x
		const code = `x <- 10`;
		await notebooksPositron.addCodeToCell(0, code, { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);

		// Add a second cell that uses x - run it once so it exists with content
		// We'll ask the assistant to run it (even if already run, runNotebookCells should still be called)
		const code2 = `result <- x + 5; print(result)`;
		await notebooksPositron.addCodeToCell(1, code2, { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 1, order: 2 }]);
	},

	postQuestion: async (ctx) => {
		const { assistant } = ctx.app.workbench;

		await assistant.clickAllowButton();
		await assistant.expectResponseComplete();
	},

	cleanup: async (ctx) => {
		await ctx.hotKeys.closeAllEditors();
		await ctx.cleanup.discardAllChanges();
	},
};
