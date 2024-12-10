/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.afterEach(async function ({ app }) {
	await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
	await app.workbench.positronLayouts.enterLayout('stacked');
});

test.describe('Variables Pane - Notebook', {
	tag: [tags.CRITICAL, tags.WEB, tags.VARIABLES, tags.NOTEBOOK]
}, () => {
	test('Python - Verifies Variables pane basic function for notebook [C669188]', async function ({ app, python }) {
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

	test('R - Verifies Variables pane basic function for notebook [C669189]', async function ({ app, r }) {
		await app.workbench.positronNotebooks.createNewNotebook();

		await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);
		await app.workbench.positronNotebooks.addCodeToFirstCell('y <- c(2, 3, 4, 5)');
		await app.workbench.positronNotebooks.executeCodeInCell();

		const interpreter = app.workbench.positronVariables.interpreterLocator;
		await expect(interpreter).toBeVisible();
		await expect(interpreter).toHaveText('Untitled-1.ipynb');

		await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');

		await expect(async () => {
			const variablesMap = await app.workbench.positronVariables.getFlatVariables();
			expect(variablesMap.get('y')).toStrictEqual({ value: '2 3 4 5', type: 'dbl [4]' });
		}).toPass({ timeout: 60000 });
	});
});

