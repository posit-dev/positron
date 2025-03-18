/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Notebooks', {
	tag: [tags.CRITICAL, tags.WEB, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.describe('Python Notebooks', () => {
		test.beforeEach(async function ({ app, python }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('Python');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('Python - Verify code cell execution in notebook', async function ({ app }) {
			await app.workbench.notebooks.addCodeToCellAtIndex('eval("8**2")');
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.assertCellOutput('64');
		});

		test('Python - Verify markdown formatting in notebook', async function ({ app }) {
			const randomText = Math.random().toString(36).substring(7);

			await app.workbench.notebooks.insertNotebookCell('markdown');
			await app.workbench.notebooks.typeInEditor(`## ${randomText} `);
			await app.workbench.notebooks.stopEditingCell();
			await app.workbench.notebooks.assertMarkdownText('h2', randomText);
		});
	});

	test.describe('R Notebooks', () => {
		test.beforeEach(async function ({ app, r }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('R');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('R - Verify code cell execution in notebook', async function ({ app }) {
			await app.workbench.notebooks.addCodeToCellAtIndex('eval(parse(text="8**2"))');
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.assertCellOutput('[1] 64');
		});

		test('R - Verify markdown formatting in notebook', async function ({ app }) {
			const randomText = Math.random().toString(36).substring(7);

			await app.workbench.notebooks.insertNotebookCell('markdown');
			await app.workbench.notebooks.typeInEditor(`## ${randomText} `);
			await app.workbench.notebooks.stopEditingCell();
			await app.workbench.notebooks.assertMarkdownText('h2', randomText);
		});
	});
});


