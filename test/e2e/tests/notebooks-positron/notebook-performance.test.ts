/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { expect } from '@playwright/test';

const NOTEBOOK_FILE = 'spotify.ipynb';
const NOTEBOOK_PATH = path.join('workspaces', 'large_py_notebook', NOTEBOOK_FILE);

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Performance', {
	tag: [tags.WIN, tags.POSITRON_NOTEBOOKS, tags.PERFORMANCE]
}, () => {

	test.beforeEach(async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		await notebooksPositron.openNotebook(NOTEBOOK_PATH);
	});

	test('render_on_open: reopen notebook from disk', async function ({ app, hotKeys, runCommand, metric }) {
		const { notebooksPositron } = app.workbench;

		// Close the notebook tab so we can measure the reopen.
		await hotKeys.closeAllEditors();

		// Use "Reopen Closed Editor" to avoid the Quick Access picker UI
		// (typing the filename, fuzzy-match, select) that openNotebook
		// goes through -- that UI latency is noise unrelated to notebook
		// render time. This restores the most recently closed editor,
		// which is the notebook opened by beforeEach.
		const { duration_ms } = await metric.notebooks.renderOnOpen(async () => {
			await runCommand('workbench.action.reopenClosedEditor');
			await expect(notebooksPositron.cell.first()).toBeVisible();
		}, 'file.ipynb', {
			description: `Reopen ${NOTEBOOK_FILE} in Positron notebook editor`,
		});

		if (!process.env.CI) { console.log(`[perf] render_on_open: ${duration_ms} ms`); }
	});

	test('render_on_nav_back: switch back to notebook tab', async function ({ app, metric }) {
		const { notebooksPositron, editors } = app.workbench;

		// Background the notebook by opening a second tab
		await editors.newUntitledFile();

		const { duration_ms } = await metric.notebooks.renderOnNavBack(async () => {
			await editors.clickTab(NOTEBOOK_FILE);
			await expect(notebooksPositron.cell.first()).toBeVisible();
		}, 'file.ipynb', {
			description: `Nav back to ${NOTEBOOK_FILE} from untitled file`,
		});

		if (!process.env.CI) { console.log(`[perf] render_on_nav_back: ${duration_ms} ms`); }
	});
});
