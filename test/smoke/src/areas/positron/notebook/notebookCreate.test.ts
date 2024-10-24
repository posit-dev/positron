/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, PositronNotebooks, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';

describe('Notebooks #pr #web #win', () => {
	setupAndStartApp();

	describe('R Notebooks', () => {
		let app: Application;
		let notebooks: PositronNotebooks;

		before(async function () {
			app = this.app as Application;
			notebooks = app.workbench.positronNotebooks;
			await PositronRFixtures.SetupFixtures(this.app as Application);
		});

		beforeEach(async function () {
			await notebooks.createNewNotebook();
			await notebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);
		});

		afterEach(async function () {
			await notebooks.closeNotebookWithoutSaving();
		});

		it('R - Basic notebook creation and execution (code) [C628629]', async function () {
			await notebooks.addCodeToFirstCell('eval(parse(text="8**2"))');
			await notebooks.executeCodeInCell();
			await notebooks.assertCellOutput('[1] 64');
		});

		it('R - Basic notebook creation and execution (markdown) [C628630]', async function () {
			const randomText = Math.random().toString(36).substring(7);

			await app.workbench.notebook.insertNotebookCell('markdown');
			await app.workbench.notebook.waitForTypeInEditor(`## ${randomText} `);
			await app.workbench.notebook.stopEditingCell();
			await notebooks.assertMarkdownText('h2', randomText);
		});
	});

	describe('Python Notebooks', () => {
		let app: Application;
		let notebooks: PositronNotebooks;

		before(async function () {
			app = this.app as Application;
			notebooks = app.workbench.positronNotebooks;
			await PositronPythonFixtures.SetupFixtures(app);
		});

		beforeEach(async function () {
			await notebooks.createNewNotebook();
			await notebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);
		});

		afterEach(async function () {
			await notebooks.closeNotebookWithoutSaving();
		});

		it('Python - Basic notebook creation and execution (code) [C628631]', async function () {
			await notebooks.addCodeToFirstCell('eval("8**2")');
			await notebooks.executeCodeInCell();
			await notebooks.assertCellOutput('64');
		});

		it('Python - Basic notebook creation and execution (markdown) [C628632]', async function () {
			const randomText = Math.random().toString(36).substring(7);

			await app.workbench.notebook.insertNotebookCell('markdown');
			await app.workbench.notebook.waitForTypeInEditor(`## ${randomText} `);
			await app.workbench.notebook.stopEditingCell();
			await notebooks.assertMarkdownText('h2', randomText);
		});
	});


});
