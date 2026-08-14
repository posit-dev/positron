/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename,
	// Turn the inline data explorer off for the whole suite. Applied before
	// launch to avoid a window reload.
	extraSettings: { 'positron.notebook.inlineDataExplorer.enabled': false }
});

const rDataFrameCode = `df <- data.frame(x = 1:3, y = 4:6)
df`;

const pythonDataFrameCode = `import pandas as pd
df = pd.DataFrame({'x': [1, 2, 3], 'y': [4, 5, 6]})
df`;

test.describe('Positron Notebooks: Inline Data Explorer Disabled', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.DATA_EXPLORER, tags.WEB, tags.WIN]
}, () => {

	test('R - Verify a data frame prints as text instead of the disabled message', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		const { notebooksPositron, inlineDataExplorer } = app.workbench;

		await test.step('Execute a cell that returns a data frame', async () => {
			await notebooksPositron.createNewNotebook();
			await notebooksPositron.kernel.select('R');
			await notebooksPositron.addCodeToCell(0, rDataFrameCode, { run: true, waitForSpinner: true });
		});

		await test.step('Verify the printed data frame is shown, not the grid', async () => {
			// Ark sends the autoprint text alongside the data explorer payload and no
			// text/html, so turning the feature off has to land on the printed output.
			await notebooksPositron.expectOutputAtIndex(0, ['1 1 4']);
			await inlineDataExplorer.expectNotToBeVisible();
		});
	});

	test('Python - Verify a DataFrame falls back to the HTML table', async function ({ app, python }) {
		const { notebooksPositron, inlineDataExplorer } = app.workbench;

		await test.step('Execute a cell that returns a DataFrame', async () => {
			await notebooksPositron.createNewNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, pythonDataFrameCode, { run: true, waitForSpinner: true });
		});

		await test.step('Verify the HTML table is shown, not the grid', async () => {
			await expect(notebooksPositron.cellOutput(0).locator('table')).toBeVisible();
			await inlineDataExplorer.expectNotToBeVisible();
		});
	});
});
