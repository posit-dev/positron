/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { tags, expect } from '../../_test.setup';
import { test } from '../_test.setup.js';

const NOTEBOOK_FILE = 'spotify.ipynb';
const NOTEBOOK_PATH = path.join('workspaces', 'large_py_notebook', NOTEBOOK_FILE);

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Render', {
	tag: [tags.WIN, tags.POSITRON_NOTEBOOKS, tags.PERFORMANCE]
}, () => {

	test('render_on_cold_open: open notebook from disk', async function ({ app, metric }) {
		const { notebooksPositron } = app.workbench;

		// Stage Quick Access (Cmd+P, type, wait for results) *outside* the
		// timed block so the metric only captures the file open + parse + render.
		await notebooksPositron.prepareOpenNotebook(NOTEBOOK_PATH);

		const { duration_ms } = await metric.notebooks.renderOnColdOpen(async () => {
			await notebooksPositron.confirmOpenNotebook();
			await expect(notebooksPositron.cell.first()).toBeVisible();
		}, 'file.ipynb', {
			description: `Open ${NOTEBOOK_FILE} in Positron notebooks`,
		});

		if (!process.env.CI) { console.log(`[perf] render_on_cold_open: ${duration_ms} ms`); }
	});

	test('render_on_open: reopen notebook from disk', async function ({ app, hotKeys, runCommand, metric }) {
		const { notebooksPositron } = app.workbench;

		// Open and close the notebook tab so we can measure the reopen.
		await notebooksPositron.openNotebook(NOTEBOOK_PATH);
		await hotKeys.closeAllEditors();

		// Use "Reopen Closed Editor" to avoid UI latency noise unrelated
		// to notebook render time.
		const { duration_ms } = await metric.notebooks.renderOnOpen(async () => {
			await runCommand('workbench.action.reopenClosedEditor');
			await expect(notebooksPositron.cell.first()).toBeVisible();
		}, 'file.ipynb', {
			description: `Reopen ${NOTEBOOK_FILE} in Positron notebooks`,
		});

		if (!process.env.CI) { console.log(`[perf] render_on_open: ${duration_ms} ms`); }
	});

	test('render_on_nav_back: switch back to notebook tab', async function ({ app, metric }) {
		const { notebooksPositron, editors } = app.workbench;

		// Open and background the notebook by opening a second tab.
		await notebooksPositron.openNotebook(NOTEBOOK_PATH);
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
