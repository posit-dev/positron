/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { test, expect } from './_test.setup';

test.use({
	suiteId: 'notebook-variables'
});

test.describe('Variables Pane - Notebook', {
	tag: ['@pr']
}, () => {

	test.beforeEach(async ({ app }) => {
		await app.workbench.positronLayouts.enterLayout('stacked');
	});


	test('Python - Verifies Variables pane basic function for notebook [C669188]', async function ({ app, interpreter }) {
		await interpreter.set('Python');

		await app.workbench.positronNotebooks.createNewNotebook();
		await app.workbench.positronNotebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);
		await app.workbench.positronNotebooks.addCodeToFirstCell('y = [2, 3, 4, 5]');
		await app.workbench.positronNotebooks.executeCodeInCell();

		const variablesInterpreter = app.workbench.positronVariables.interpreterLocator;
		await expect(variablesInterpreter).toBeVisible();
		await expect(variablesInterpreter).toHaveText('Untitled-1.ipynb');

		await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');
		const variablesMap = await app.workbench.positronVariables.getFlatVariables();
		expect(variablesMap.get('y')).toStrictEqual({ value: '[2, 3, 4, 5]', type: 'list [4]' });
		await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
	});

	test('R - Verifies Variables pane basic function for notebook [C669189]', { tag: ['@web'] }, async function ({ app, interpreter }) {
		await interpreter.set('R');

		await app.workbench.positronNotebooks.createNewNotebook();
		await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);
		await app.workbench.positronNotebooks.addCodeToFirstCell('y <- c(2, 3, 4, 5)');
		await app.workbench.positronNotebooks.executeCodeInCell();

		const variablesInterpreter = app.workbench.positronVariables.interpreterLocator;
		await expect(variablesInterpreter).toBeVisible();
		await expect(variablesInterpreter).toHaveText('Untitled-1.ipynb');

		await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');
		const variablesMap = await app.workbench.positronVariables.getFlatVariables();
		expect(variablesMap.get('y')).toStrictEqual({ value: '2 3 4 5', type: 'dbl [4]' });
		await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
	});
});
