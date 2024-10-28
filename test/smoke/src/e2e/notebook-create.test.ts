/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_test.setup';

// 1a. remove all setupAndStartApp()
// 1b. remove all setup Python/R fixtures
// 2. replace test blocks
// 3. replace all #tags with proper tags

// tags, app/restartApp fixtures, tracing, html reports, restarts if test failed, show on test-fail
test.describe('Notebooks', { tag: ['@pr', '@web', '@win'] }, () => {
	test.describe('Python Notebooks', () => {
		test.beforeEach(async function ({ app, interpreter }) {
			await interpreter.set('Python');
			await app.workbench.positronLayouts.enterLayout('notebook');
			await app.workbench.positronNotebooks.createNewNotebook();
			await app.workbench.positronNotebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
		});

		test('Python - Basic notebook creation and execution (code) [C628631]', async function ({ app }) {
			await app.workbench.positronNotebooks.addCodeToFirstCell('eval("8**2")');
			await app.workbench.positronNotebooks.executeCodeInCell();
			await app.workbench.positronNotebooks.assertCellOutput('64');
		});

		test('Python - Basic notebook creation and execution (markdown) [C628632]', async function ({ app }) {
			const randomText = Math.random().toString(36).substring(7);

			await app.workbench.notebook.insertNotebookCell('markdown');
			await app.workbench.notebook.waitForTypeInEditor(`## ${randomText} `);
			await app.workbench.notebook.stopEditingCell();
			await app.workbench.positronNotebooks.assertMarkdownText('h2', randomText);

			// expect(await app.workbench.positronNotebooks.getMarkdownText(`h2 >> text="${randomText}"`)).toBe(randomText);
		});
	});

	test.describe.skip('R Notebooks', () => {
		test.beforeEach(async function ({ app, interpreter }) {
			await interpreter.set('R');
			await app.workbench.positronLayouts.enterLayout('notebook');
			await app.workbench.positronNotebooks.createNewNotebook();
			await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
		});

		test('R - Basic notebook creation and execution (code) [C628629]', async function ({ app }) {
			await app.workbench.positronNotebooks.addCodeToFirstCell('eval(parse(text="8**2"))');
			await app.workbench.positronNotebooks.executeCodeInCell();
			await app.workbench.positronNotebooks.assertCellOutput('[1] 64');
		});

		test('R - Basic notebook creation and execution (markdown) [C628630]', async function ({ app }) {
			const randomText = Math.random().toString(36).substring(7);

			await app.workbench.notebook.insertNotebookCell('markdown');
			await app.workbench.notebook.waitForTypeInEditor(`## ${randomText} `);
			await app.workbench.notebook.stopEditingCell();
			await app.workbench.positronNotebooks.assertMarkdownText('h2', randomText);

			// expect(await app.workbench.positronNotebooks.getMarkdownText(`h2 >> text="${randomText}"`)).toBe(randomText);

		});
	});

});

