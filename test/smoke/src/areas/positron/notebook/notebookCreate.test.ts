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

			it('Python - Basic notebook creation and execution', async function () {
				const app = this.app as Application;

				await app.workbench.positronNotebooks.createNewNotebook();

				await app.workbench.positronNotebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);

				await app.workbench.positronNotebooks.executeInFirstCell('eval("8**2")');

				const outputText = await app.workbench.positronNotebooks.getPythonCellOutput();

				expect(outputText).toBe('64');

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

			it('R - Basic notebook creation and execution', async function () {
				const app = this.app as Application;

				await app.workbench.positronNotebooks.createNewNotebook();

				await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);

				await app.workbench.positronNotebooks.executeInFirstCell('eval(parse(text="8**2"))');

				const outputText = await app.workbench.positronNotebooks.getRCellOutput();

				expect(outputText).toBe('[1] 64\n');

			});
		});
	});
}
