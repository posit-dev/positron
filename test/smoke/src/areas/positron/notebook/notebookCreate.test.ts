/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {

	describe('Notebooks', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Notebooks', () => {

			before(async function () {

				const app = this.app as Application;

				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();

			});

			after(async function () {

				const app = this.app as Application;
				await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
			});

			it('Python - Basic notebook creation and execution (code)', async function () {
				// TestRail #628631
				const app = this.app as Application;

				await app.workbench.positronNotebooks.createNewNotebook();

				await app.workbench.positronNotebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);

				await app.workbench.positronNotebooks.executeInFirstCell('eval("8**2")');

				expect(await app.workbench.positronNotebooks.getPythonCellOutput()).toBe('64');

			});

			it('Python - Basic notebook creation and execution (markdown)', async function () {
				// TestRail #628632
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

				const app = this.app as Application;

				const rFixtures = new PositronRFixtures(app);
				await rFixtures.startRInterpreter();

			});

			after(async function () {

				const app = this.app as Application;
				await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
			});

			it('R - Basic notebook creation and execution (code)', async function () {
				// TestRail #628629
				const app = this.app as Application;

				await app.workbench.positronNotebooks.createNewNotebook();

				await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);

				await app.workbench.positronNotebooks.executeInFirstCell('eval(parse(text="8**2"))');

				expect(await app.workbench.positronNotebooks.getRCellOutput()).toBe('[1] 64');

			});

			it('R - Basic notebook creation and execution (markdown)', async function () {
				// TestRail #628630
				const app = this.app as Application;

				await app.workbench.notebook.insertNotebookCell('markdown');

				await app.workbench.notebook.waitForTypeInEditor('## hello2! ');
				await app.workbench.notebook.stopEditingCell();

				expect(await app.workbench.positronNotebooks.getMarkdownText('h2')).toBe('hello2!');

			});
		});
	});
}
