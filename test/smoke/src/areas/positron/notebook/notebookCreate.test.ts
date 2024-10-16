/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';

describe('Notebooks #pr #web #win', () => {
	setupAndStartApp();

	describe('Python Notebooks', () => {
		let app: Application;

		before(async function () {
			app = this.app as Application;
			await PositronPythonFixtures.SetupFixtures(app);
			await app.workbench.positronLayouts.enterLayout('notebook');
		});

		beforeEach(async function () {
			await app.workbench.positronNotebooks.createNewNotebook();
			await app.workbench.positronNotebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);
		});

		afterEach(async function () {
			await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
		});

		it('Python - Basic notebook creation and execution (code) [C628631]', async function () {
			await expect(async () => {
				await app.workbench.positronNotebooks.addCodeToFirstCell('eval("8**2")');
				await app.workbench.positronNotebooks.executeCodeInCell();

				expect(await app.workbench.positronNotebooks.getPythonCellOutput()).toBe('64');
			}).toPass({ timeout: 120000 });
		});

		it('Python - Basic notebook creation and execution (markdown) [C628632]', async function () {
			const randomText = Math.random().toString(36).substring(7);

			await app.workbench.notebook.insertNotebookCell('markdown');
			await app.workbench.notebook.waitForTypeInEditor(`## ${randomText} `);
			await app.workbench.notebook.stopEditingCell();

			expect(await app.workbench.positronNotebooks.getMarkdownText(`h2 >> text="${randomText}"`)).toBe(randomText);
		});
	});
});

describe('Notebooks #pr #web #win', () => {
	setupAndStartApp();

	describe('R Notebooks', () => {
		let app: Application;

		before(async function () {
			app = this.app as Application;
			await PositronRFixtures.SetupFixtures(this.app as Application);
		});

		beforeEach(async function () {
			await app.workbench.positronNotebooks.createNewNotebook();
			await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);
		});

		afterEach(async function () {
			await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
		});

		it('R - Basic notebook creation and execution (code) [C628629]', async function () {
			await app.workbench.positronNotebooks.addCodeToFirstCell('eval(parse(text="8**2"))');

			await expect(async () => {
				await app.workbench.positronNotebooks.executeCodeInCell();
				expect(await app.workbench.positronNotebooks.getRCellOutput()).toBe('[1] 64');
			}).toPass({ timeout: 60000 });

		});

		it('R - Basic notebook creation and execution (markdown) [C628630]', async function () {
			const randomText = Math.random().toString(36).substring(7);

			await app.workbench.notebook.insertNotebookCell('markdown');
			await app.workbench.notebook.waitForTypeInEditor(`## ${randomText} `);
			await app.workbench.notebook.stopEditingCell();

			expect(await app.workbench.positronNotebooks.getMarkdownText(`h2 >> text="${randomText}"`)).toBe(randomText);

		});
	});
});
