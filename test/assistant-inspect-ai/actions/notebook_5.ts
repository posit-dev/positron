/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SampleActions } from './types';

/**
 * Notebook 5: createNotebook Tool
 *
 * TOOL: createNotebook
 * SCENARIO: When asked to create a new notebook, the assistant should use
 *           createNotebook with the appropriate language (R or Python).
 *
 * This test starts with no notebooks open and asks the assistant to create
 * a new R notebook. The assistant MUST call createNotebook with R as the language.
 */
export const actions: SampleActions = {
	setup: async (ctx) => {
		await ctx.settings.set({ 'positron.notebook.enabled': true }, { reload: 'web' });
		await ctx.hotKeys.closeAllEditors();
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
