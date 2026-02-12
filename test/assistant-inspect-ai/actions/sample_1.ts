/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SampleActions } from './types';

/**
 * Sample 1: R forested package hallucination test
 *
 * Tests that the LLM doesn't hallucinate column names when asked to plot
 * data from the forested package without first exploring it.
 */
export const actions: SampleActions = {
	setup: async (ctx) => {
		// Select the R session for this test
		await ctx.sessions.select(ctx.sessions.r.id);
	},

	cleanup: async (ctx) => {
		// Explicitly focus console before restart to ensure UI is ready
		await ctx.app.workbench.console.focus();
		await ctx.sessions.restart(ctx.sessions.r.id);
	},
};
