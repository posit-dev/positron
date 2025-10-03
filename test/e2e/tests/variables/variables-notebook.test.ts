/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

const FILENAME = 'Untitled-1.ipynb';

test.use({
	suiteId: __filename
});

test.afterEach(async function ({ app }) {
	await app.workbench.notebooks.closeNotebookWithoutSaving();
});

test.describe('Variables Pane - Notebook', {
	tag: [tags.CRITICAL, tags.WEB, tags.VARIABLES, tags.NOTEBOOKS]
}, () => {
	test('R - Verify Variables pane basic function for notebook', {
		tag: [tags.ARK]
	}, async function ({ app, hotKeys }) {
		const { notebooks, variables } = app.workbench;

		// Create a variable via a notebook
		await notebooks.createNewNotebook();
		await notebooks.selectInterpreter('R');
		await notebooks.addCodeToCellAtIndex('y <- c(2, 3, 4, 5)');
		await notebooks.executeCodeInCell();

		// Verify the interpreter and var in the variable pane
		await hotKeys.fullSizeSecondarySidebar();
		await variables.expectSessionToBe('Untitled-1.ipynb');
		await variables.expectVariableToBe('y', '2 3 4 5');
	});

	test('Python - Verify Variables pane basic function for notebook', async function ({ app }) {
		const { notebooks, variables, hotKeys } = app.workbench;

		// Create a variable via a notebook
		await notebooks.createNewNotebook();
		await notebooks.selectInterpreter('Python');
		await notebooks.addCodeToCellAtIndex('y = [2, 3, 4, 5]');
		await notebooks.executeCodeInCell();

		// Verify the interpreter and var in the variable pane
		await hotKeys.fullSizeSecondarySidebar();
		await variables.expectSessionToBe(FILENAME);
		await variables.expectVariableToBe('y', '[2, 3, 4, 5]');
	});

	test('Python - Verify Variables available after reload', async function ({ app, sessions, hotKeys }) {
		const { notebooks, variables } = app.workbench;

		// Create a variable via a notebook
		await notebooks.createNewNotebook();
		await notebooks.selectInterpreter('Python');
		await notebooks.addCodeToCellAtIndex('dict = [{"a":1,"b":2},{"a":3,"b":4}]');
		await notebooks.executeCodeInCell();

		// Verify the interpreter and var in the variable pane
		await hotKeys.fullSizeSecondarySidebar();
		await variables.expectSessionToBe(FILENAME);
		await variables.expectVariableToBe('dict', `[{'a': 1, 'b': 2}, {'a': 3, 'b': 4}]`);

		// Reload window
		await hotKeys.reloadWindow();
		await sessions.expectAllSessionsToBeReady();

		// Ensure the variable is still present
		await variables.selectSession(FILENAME);
		await variables.expectVariableToBe('dict', `[{'a': 1, 'b': 2}, {'a': 3, 'b': 4}]`);
	});
});

