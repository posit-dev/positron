/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';

describe('Variables Pane - Notebook', () => {

	describe('Python Notebook Variables Pane #pr #web', () => {
		setupAndStartApp();

		before(async function () {
			await PositronPythonFixtures.SetupFixtures(this.app as Application);
		});

		it('Verifies Variables pane basic function for notebook with python interpreter [C669188]', async function () {
			const app = this.app as Application;

			await app.workbench.positronNotebooks.createNewNotebook();

			// workaround issue where starting multiple interpreters in quick succession can cause startup failure
			await app.code.wait(1000);

			await app.workbench.positronNotebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);
			await app.workbench.positronNotebooks.addCodeToFirstCell('y = [2, 3, 4, 5]');
			await app.workbench.positronNotebooks.executeCodeInCell();

			const filename = 'Untitled-1.ipynb';

			// temporary workaround for fact that variables group
			// not properly autoselected on web
			if (app.web) {
				await app.workbench.positronVariables.selectVariablesGroup(filename);
			}

			const interpreter = app.workbench.positronVariables.interpreterLocator;
			await expect(interpreter).toBeVisible();
			await expect(interpreter).toHaveText(filename);

			await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');
			const variablesMap = await app.workbench.positronVariables.getFlatVariables();
			expect(variablesMap.get('y')).toStrictEqual({ value: '[2, 3, 4, 5]', type: 'list [4]' });
		});
	});

	describe('R Notebook Variables Pane #pr #web', () => {
		setupAndStartApp();

		before(async function () {
			await PositronRFixtures.SetupFixtures(this.app as Application);
		});

		it('Verifies Variables pane basic function for notebook with R interpreter [C669189]', async function () {
			const app = this.app as Application;

			await app.workbench.positronNotebooks.createNewNotebook();

			// workaround issue where starting multiple interpreters in quick succession can cause startup failure
			await app.code.wait(1000);

			await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);
			await app.workbench.positronNotebooks.addCodeToFirstCell('y <- c(2, 3, 4, 5)');
			await app.workbench.positronNotebooks.executeCodeInCell();

			const interpreter = app.workbench.positronVariables.interpreterLocator;
			await expect(interpreter).toBeVisible();
			await expect(interpreter).toHaveText('Untitled-1.ipynb');

			await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');
			const variablesMap = await app.workbench.positronVariables.getFlatVariables();
			expect(variablesMap.get('y')).toStrictEqual({ value: '2 3 4 5', type: 'dbl [4]' });
		});

	});
});

