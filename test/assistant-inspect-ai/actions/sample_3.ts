/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { join } from 'path';
import { SampleActions } from './types';

/**
 * Sample 3: positron_editFile_internal tool test
 *
 * Tests that the positron_editFile_internal tool is called to edit a file
 * using Python and the chinook-sqlite.py file.
 */
export const actions: SampleActions = {
	setup: async (ctx) => {
		await expect(async () => {
			await ctx.sessions.select(ctx.sessions.python.id);
			await ctx.app.workbench.quickaccess.openFile(
				join(ctx.app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py')
			);
		}).toPass({ timeout: 5000 });
	},

	postQuestion: async (ctx) => {
		try {
			// Wait up to 20 seconds for the Keep button to appear
			await ctx.app.workbench.assistant.clickKeepButton();
			console.log('Keep button clicked for sample_3');
			await ctx.app.workbench.assistant.waitForResponseComplete();
		} catch (error) {
			// Keep button didn't appear or wasn't clickable
			// Don't fail so the rest of the tests can continue
			console.log('Keep button not found or not clickable for sample_3 (this is OK)');
		}
	},

	cleanup: async (ctx) => {
		await ctx.hotKeys.closeAllEditors();
		// Explicitly focus console before restart to ensure UI is ready
		await ctx.app.workbench.console.focus();
		// await ctx.sessions.restart(ctx.sessions.python.id, { clearConsole: false });
		await ctx.cleanup.discardAllChanges();
	},
};
