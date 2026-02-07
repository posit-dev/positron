/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SampleActions } from './types';

/**
 * Notebook 1: Automatic Context (Small Notebook)
 *
 * TOOL: None (automatic context injection)
 * SCENARIO: Small notebooks (< 20 cells) have their content automatically
 *           included in the assistant's context without requiring tool calls.
 *
 * This test creates a 1-cell notebook with revenue data and asks the assistant
 * to calculate the total. The assistant should answer correctly using the
 * automatically-provided context, without calling getNotebookCells.
 */
export const actions: SampleActions = {
	setup: async (ctx) => {
		await ctx.settings.set({ 'positron.notebook.enabled': true }, { reload: 'web' });
		const { notebooksPositron } = ctx.app.workbench;

		// Create a new notebook and select R kernel
		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('R');

		// Add a cell that creates a data frame with specific data
		const code = `df <- data.frame(month = c('January', 'February', 'March'), revenue = c(45000, 52000, 48500), units_sold = c(150, 175, 162)); df`;
		await notebooksPositron.addCodeToCell(0, code, { run: true });
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
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
