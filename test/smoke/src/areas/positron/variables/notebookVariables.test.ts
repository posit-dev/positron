/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 * Variables Pane test cases
 */
export function setup(logger: Logger) {
	describe('Variables Pane - Notebook', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Notebook Variables Pane', () => {

			before(async function () {
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			after(async function () {

				const app = this.app as Application;
				await app.workbench.positronNotebooks.closeNotebookWithoutSaving();

				await app.workbench.positronLayouts.enterLayout('stacked');
			});

			it('Verifies Variables pane basic function for notebook with python interpreter [C669188] #pr', async function () {
				const app = this.app as Application;

				await app.workbench.positronNotebooks.createNewNotebook();

				await app.workbench.positronNotebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);

				const interpreter = await app.workbench.positronVariables.getVariablesInterpreter();

				expect(interpreter.textContent).toBe('Untitled-1.ipynb');

				await app.workbench.positronNotebooks.addCodeToFirstCell('y = [2, 3, 4, 5]');

				await app.workbench.positronNotebooks.executeCodeInCell();

				// just to be safe, give cell some execution time
				await app.code.wait(1000);

				await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');

				const variablesMap = await app.workbench.positronVariables.getFlatVariables();

				expect(variablesMap.get('y')).toStrictEqual({ value: '[2, 3, 4, 5]', type: 'list [4]' });

			});

		});

	});

	describe('Variables Pane - Notebook', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('R Notebook Variables Pane', () => {

			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);
			});

			after(async function () {

				const app = this.app as Application;
				await app.workbench.positronNotebooks.closeNotebookWithoutSaving();

				await app.workbench.positronLayouts.enterLayout('stacked');
			});

			it('Verifies Variables pane basic function for notebook with R interpreter [C669189] #pr', async function () {
				const app = this.app as Application;

				await app.workbench.positronNotebooks.createNewNotebook();

				await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);

				const interpreter = await app.workbench.positronVariables.getVariablesInterpreter();

				expect(interpreter.textContent).toBe('Untitled-1.ipynb');

				await app.workbench.positronNotebooks.addCodeToFirstCell('y <- c(2, 3, 4, 5)');

				await app.workbench.positronNotebooks.executeCodeInCell();

				// just to be safe, give cell some execution time
				await app.code.wait(1000);

				await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');

				const variablesMap = await app.workbench.positronVariables.getFlatVariables();

				expect(variablesMap.get('y')).toStrictEqual({ value: '2 3 4 5', type: 'dbl [4]' });

			});

		});
	});
}
