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
		await notebooksPositron.expectToBeVisible();
		await expect(notebooksPositron.cell.first()).toBeVisible();
	});

	test('render_on_open: reopen notebook from disk', async function ({ app, hotKeys, metric }) {
		const { notebooksPositron } = app.workbench;

		// Close the notebook tab so we can measure the cold reopen.
		await hotKeys.closeAllEditors();

		const { duration_ms } = await metric.notebooks.renderOnOpen(async () => {
			await notebooksPositron.openNotebook(NOTEBOOK_PATH);
			await notebooksPositron.expectToBeVisible();
			await expect(notebooksPositron.cell.first()).toBeVisible();
		}, 'file.ipynb', {
			description: `Reopen ${NOTEBOOK_FILE} in Positron notebook editor`,
		});

		// Pure telemetry for v1: log the duration, no hard assertion.
		console.log(`[perf] render_on_open: ${duration_ms} ms`);
	});

	test('render_on_nav_back: switch back to notebook tab', async function ({ app, metric }) {
		const { notebooksPositron, editors } = app.workbench;

		// Background the notebook by opening a second tab (canonical source tab).
		// Matches the pattern used by notebook-scroll-position.test.ts.
		await editors.newUntitledFile();

		const { duration_ms } = await metric.notebooks.renderOnNavBack(async () => {
			// Click the notebook tab directly. We can't use editors.selectTab()
			// because it expects a Monaco editor to receive focus, but the
			// Positron notebook is a custom editor.
			await app.code.driver.page.getByRole('tab', { name: NOTEBOOK_FILE }).click();
			await notebooksPositron.expectToBeVisible();
			await expect(notebooksPositron.cell.first()).toBeVisible();
		}, 'file.ipynb', {
			description: `Nav back to ${NOTEBOOK_FILE} from untitled file`,
		});

		console.log(`[perf] render_on_nav_back: ${duration_ms} ms`);
	});
});
