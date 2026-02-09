/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SampleActions } from './types';

/**
 * Notebook 2: getNotebookCells Tool (Large Notebook)
 *
 * TOOL: getNotebookCells
 * SCENARIO: Large notebooks (>= 20 cells) use a sliding window for automatic context.
 *           Cells outside the window require an explicit getNotebookCells tool call.
 *
 * This test creates a 21-cell notebook where each cell calculates `x * 10`.
 * Cell 0 is selected, so cell 20 is outside the automatic context window.
 * When asked about cell 20, the assistant MUST call getNotebookCells to fetch it.
 */
export const actions: SampleActions = {
	setup: async (ctx) => {
		await ctx.settings.set({ 'positron.notebook.enabled': true }, { reload: 'web' });
		const { notebooksPositron } = ctx.app.workbench;

		// Create a new notebook and select R kernel
		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('R');

		// Create 21 cells (indices 0-20) so it's a "large" notebook
		for (let i = 0; i < 21; i++) {
			const code = `x <- ${i}; result_${i} <- x * 10; result_${i}`;
			await notebooksPositron.addCodeToCell(i, code, { run: true });
			await notebooksPositron.expectExecutionOrder([{ index: i, order: i + 1 }]);
		}

		// Select cell 0 so the sliding window is at the beginning
		// This ensures cell 20 is outside the automatic context window
		await notebooksPositron.selectCellAtIndex(0);
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
