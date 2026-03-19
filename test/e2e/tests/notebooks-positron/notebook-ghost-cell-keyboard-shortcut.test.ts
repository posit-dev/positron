/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook: Ghost Cell Keyboard Shortcut', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Ghost cell workflow: Automatic mode to On-demand mode with Accept and Run', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// Setup notebook with sample code
		await notebooksPositron.newNotebook({ codeCells: 2 });
		await notebooksPositron.addCodeToCell(0, 'import pandas as pd\ndf = pd.read_csv("data.csv")', { run: false });
		await notebooksPositron.addCodeToCell(1, 'df_clean = df.dropna()', { run: false });
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });

		// Trigger ghost cell with keyboard shortcut
		await hotKeys.triggerGhostCell();

		// Verify "Generating suggestion..." appears
		await notebooksPositron.expectGhostCellGenerationVisible();

		// Wait for ghost cell to appear and verify all components
		await notebooksPositron.expectGhostCellVisible();

		// Verify default mode is Automatic
		await notebooksPositron.expectGhostCellMode(true);

		// Switch to On-demand mode
		await notebooksPositron.selectGhostCellMode(false);
		// Note: selectGhostCellMode already verifies the mode was selected

		// Accept and Run the suggestion
		await notebooksPositron.acceptGhostCellSuggestion();

		// Verify cell is generated and executed (cell count increases)
		await notebooksPositron.expectCellCountToBe(3);

		// Verify "AI suggestion available on request" appears for On-demand mode
		await notebooksPositron.expectGhostCellAwaitingRequest();

		// Request a suggestion to trigger generation again
		await notebooksPositron.getSuggestion();

		// Verify "Generating suggestion..." appears again
		await notebooksPositron.expectGhostCellGenerationVisible();
	});
});