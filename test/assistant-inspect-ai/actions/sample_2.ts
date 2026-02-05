/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { join } from 'path';
import { SampleActions } from './types';

/**
 * Sample 2: getTableSummary tool test
 *
 * Tests that the getTableSummary tool is called in 'ask' mode
 * using Python and the chinook-sqlite.py file.
 */
export const actions: SampleActions = {
	setup: async (ctx) => {
		await expect(async () => {
			await ctx.sessions.select(ctx.sessions.python.id);
			await ctx.app.workbench.quickaccess.openFile(
				join(ctx.app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py')
			);
			await ctx.app.workbench.quickaccess.runCommand('python.execInConsole');
		}).toPass({ timeout: 5000 });
	},

	cleanup: async (ctx) => {
		await ctx.hotKeys.closeAllEditors();
		// Explicitly focus console before restart to ensure UI is ready
		await ctx.app.workbench.console.focus();
		await ctx.sessions.restart(ctx.sessions.python.id);
		await ctx.cleanup.discardAllChanges();
	},
};
