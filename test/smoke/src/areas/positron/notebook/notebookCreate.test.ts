/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../positronUtils';

describe('Notebooks #pr #web #win', () => {
	setupAndStartApp();

	describe('Python Notebooks', () => {

		before(async function () {

			await PositronPythonFixtures.SetupFixtures(this.app as Application);

		});

		after(async function () {

			const app = this.app as Application;
			await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
		});

		it('Python - Basic notebook creation and execution (code) [C628631]', async function () {
			const app = this.app as Application;

			await app.workbench.positronLayouts.enterLayout('notebook');

			await expect(async () => {

				try {
					await app.workbench.positronNotebooks.createNewNotebook();

					await app.workbench.positronNotebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);

					await app.workbench.positronNotebooks.addCodeToFirstCell('eval("8**2")');

					await app.workbench.positronNotebooks.executeCodeInCell();

					expect(await app.workbench.positronNotebooks.getPythonCellOutput()).toBe('64');
				} catch (e) {
					await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
				}
			}).toPass({ timeout: 120000 });

		});

		it('Python - Basic notebook creation and execution (markdown) [C628632]', async function () {
			const app = this.app as Application;

			await app.workbench.notebook.insertNotebookCell('markdown');

			await app.workbench.notebook.waitForTypeInEditor('## hello2! ');
			await app.workbench.notebook.stopEditingCell();

			expect(await app.workbench.positronNotebooks.getMarkdownText('h2')).toBe('hello2!');

		});
	});
});

describe('Notebooks #pr #web #win', () => {
	setupAndStartApp();

	describe('R Notebooks', () => {

		before(async function () {

			await PositronRFixtures.SetupFixtures(this.app as Application);

		});

		after(async function () {

			const app = this.app as Application;
			await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
		});

		it('R - Basic notebook creation and execution (code) [C628629]', async function () {
			const app = this.app as Application;

			await app.workbench.positronLayouts.enterLayout('notebook');

			await app.workbench.positronNotebooks.createNewNotebook();

			await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);

			await app.workbench.positronNotebooks.addCodeToFirstCell('eval(parse(text="8**2"))');

			await expect(async () => {
				await app.workbench.positronNotebooks.executeCodeInCell();
				expect(await app.workbench.positronNotebooks.getRCellOutput()).toBe('[1] 64');
			}).toPass({ timeout: 60000 });

		});

		it('R - Basic notebook creation and execution (markdown) [C628630]', async function () {
			const app = this.app as Application;

			await app.workbench.notebook.insertNotebookCell('markdown');

			await app.workbench.notebook.waitForTypeInEditor('## hello2! ');
			await app.workbench.notebook.stopEditingCell();

			expect(await app.workbench.positronNotebooks.getMarkdownText('h2')).toBe('hello2!');

		});
	});
});
