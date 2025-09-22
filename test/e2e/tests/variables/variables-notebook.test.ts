/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.afterEach(async function ({ app }) {
	await app.positron.notebooks.closeNotebookWithoutSaving();
});

test.describe('Variables Pane - Notebook', {
	tag: [tags.CRITICAL, tags.WEB, tags.VARIABLES, tags.NOTEBOOKS]
}, () => {
	test('Python - Verify Variables pane basic function for notebook', async function ({ app, python }) {
		await app.positron.notebooks.createNewNotebook();

		// workaround issue where starting multiple interpreters in quick succession can cause startup failure
		await app.code.wait(1000);

		await app.positron.notebooks.selectInterpreter('Python');
		await app.positron.notebooks.addCodeToCellAtIndex('y = [2, 3, 4, 5]');
		await app.positron.notebooks.executeCodeInCell();

		const filename = 'Untitled-1.ipynb';

		const interpreter = app.positron.variables.interpreterLocator;
		await expect(interpreter).toBeVisible();
		await expect(interpreter).toHaveText(filename);
		await app.positron.layouts.enterLayout('fullSizedAuxBar');

		await expect(async () => {
			const variablesMap = await app.positron.variables.getFlatVariables();
			expect(variablesMap.get('y')).toStrictEqual({ value: '[2, 3, 4, 5]', type: 'list [4]' });
		}).toPass({ timeout: 60000 });
	});

	test('R - Verify Variables pane basic function for notebook', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		await app.positron.notebooks.createNewNotebook();

		await app.positron.notebooks.selectInterpreter('R');
		await app.positron.notebooks.addCodeToCellAtIndex('y <- c(2, 3, 4, 5)');
		await app.positron.notebooks.executeCodeInCell();

		const interpreter = app.positron.variables.interpreterLocator;
		await expect(interpreter).toBeVisible();
		await expect(interpreter).toHaveText('Untitled-1.ipynb');
		await app.positron.layouts.enterLayout('fullSizedAuxBar');

		await expect(async () => {
			const variablesMap = await app.positron.variables.getFlatVariables();
			expect(variablesMap.get('y')).toStrictEqual({ value: '2 3 4 5', type: 'dbl [4]' });
		}).toPass({ timeout: 60000 });
	});
});

