/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 * Notebook creation test cases
 */
export function setup(logger: Logger) {

	describe('Notebooks', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Notebooks', () => {

			before(async function () {

				await PositronPythonFixtures.SetupFixtures(this.app as Application);

			});

			after(async function () {

				const app = this.app as Application;
				await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
			});

			it('Python - Basic notebook creation and execution (code) [C628631] #nightly #pr', async function () {
				const app = this.app as Application;

				await app.workbench.positronNotebooks.createNewNotebook();

				await app.workbench.positronNotebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);

				await expect(async () => {
					await app.workbench.positronNotebooks.executeInFirstCell('eval("8**2")');
					expect(await app.workbench.positronNotebooks.getPythonCellOutput()).toBe('64');
				}).toPass({timeout: 60000});

			});

			it('Python - Basic notebook creation and execution (markdown) [C628632] #nightly #pr', async function () {
				const app = this.app as Application;

				await app.workbench.notebook.insertNotebookCell('markdown');

				await app.workbench.notebook.waitForTypeInEditor('## hello2! ');
				await app.workbench.notebook.stopEditingCell();

				expect(await app.workbench.positronNotebooks.getMarkdownText('h2')).toBe('hello2!');

			});
		});
	});

	describe('Notebooks', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('R Notebooks', () => {

			before(async function () {

				await PositronRFixtures.SetupFixtures(this.app as Application);

			});

			after(async function () {

				const app = this.app as Application;
				await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
			});

			it('R - Basic notebook creation and execution (code) [C628629] #nightly #pr', async function () {
				const app = this.app as Application;

				await app.workbench.positronNotebooks.createNewNotebook();

				await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);

				await expect(async () => {
					await app.workbench.positronNotebooks.executeInFirstCell('eval(parse(text="8**2"))');
					expect(await app.workbench.positronNotebooks.getRCellOutput()).toBe('[1] 64');
				}).toPass({timeout: 60000});

			});

			it('R - Basic notebook creation and execution (markdown) [C628630] #nightly #pr', async function () {
				const app = this.app as Application;

				await app.workbench.notebook.insertNotebookCell('markdown');

				await app.workbench.notebook.waitForTypeInEditor('## hello2! ');
				await app.workbench.notebook.stopEditingCell();

				expect(await app.workbench.positronNotebooks.getMarkdownText('h2')).toBe('hello2!');

			});
		});
	});
}
