/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.afterEach(async function ({ app }) {
	await app.workbench.notebooks.closeNotebookWithoutSaving();
});

test.describe('Variables Pane - Notebook', {
	tag: [tags.CRITICAL, tags.WEB, tags.VARIABLES, tags.NOTEBOOKS]
}, () => {
	test('Python - Verify Variables pane basic function for notebook', async function ({ app, python }) {
		await app.workbench.notebooks.createNewNotebook();

		// workaround issue where starting multiple interpreters in quick succession can cause startup failure
		await app.code.wait(1000);

		await app.workbench.notebooks.selectInterpreter('Python');
		await app.workbench.notebooks.addCodeToCellAtIndex('y = [2, 3, 4, 5]');
		await app.workbench.notebooks.executeCodeInCell();

		const filename = 'Untitled-1.ipynb';

		const interpreter = app.workbench.variables.interpreterLocator;
		await expect(interpreter).toBeVisible();
		await expect(interpreter).toHaveText(filename);
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');

		await expect(async () => {
			const variablesMap = await app.workbench.variables.getFlatVariables();
			expect(variablesMap.get('y')).toStrictEqual({ value: '[2, 3, 4, 5]', type: 'list [4]' });
		}).toPass({ timeout: 60000 });
	});

	test('Python - Verify Variables available after reload', async function ({ app, runCommand, sessions }) {
		await app.workbench.notebooks.createNewNotebook();
		await app.code.wait(1000);

		// Create a variable
		await app.workbench.notebooks.selectInterpreter('Python');
		await app.workbench.notebooks.addCodeToCellAtIndex('dict = [{"a":1,"b":2},{"a":3,"b":4}]');
		await app.workbench.notebooks.executeCodeInCell();

		const filename = 'Untitled-1.ipynb';

		const interpreter = app.workbench.variables.interpreterLocator;
		await expect(interpreter).toBeVisible();
		await expect(interpreter).toHaveText(filename);
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');

		// Ensure the variable is present
		await expect(async () => {
			const variablesMap = await app.workbench.variables.getFlatVariables();
			expect(variablesMap.get('dict')).toStrictEqual({ value: `[{'a': 1, 'b': 2}, {'a': 3, 'b': 4}]`, type: 'list [2]' });
		}).toPass({ timeout: 30000 });

		// Reload window
		await runCommand('workbench.action.reloadWindow');
		await sessions.expectAllSessionsToBeReady();

		// Get the variable again and ensure it's still present
		await expect(async () => {
			const variablesMap = await app.workbench.variables.getFlatVariables();
			expect(variablesMap.get('dict')).toStrictEqual({ value: `[{'a': 1, 'b': 2}, {'a': 3, 'b': 4}]`, type: 'list [2]' });
		}).toPass({ timeout: 30000 });

	});

	test('R - Verify Variables pane basic function for notebook', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		await app.workbench.notebooks.createNewNotebook();

		await app.workbench.notebooks.selectInterpreter('R');
		await app.workbench.notebooks.addCodeToCellAtIndex('y <- c(2, 3, 4, 5)');
		await app.workbench.notebooks.executeCodeInCell();

		const interpreter = app.workbench.variables.interpreterLocator;
		await expect(interpreter).toBeVisible();
		await expect(interpreter).toHaveText('Untitled-1.ipynb');
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');

		await expect(async () => {
			const variablesMap = await app.workbench.variables.getFlatVariables();
			expect(variablesMap.get('y')).toStrictEqual({ value: '2 3 4 5', type: 'dbl [4]' });
		}).toPass({ timeout: 60000 });
	});
});

