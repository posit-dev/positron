/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';

import { PositronPythonFixtures } from '../../../automation';
import { test } from './test.setup';

// tags, app/restartApp fixtures, tracing, html reports, restarts if test failed, show on test-fail

test.describe('Python Notebooks', () => {

	test.beforeAll(async function ({ app }) {
		await PositronPythonFixtures.SetupFixtures(app);
		await app.workbench.positronLayouts.enterLayout('notebook');
	});

	test.beforeEach(async function ({ app }) {
		await app.workbench.positronNotebooks.createNewNotebook();
		await app.workbench.positronNotebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
	});

	test('Python - Basic notebook creation and execution (code) [C628631]', async function ({ app }) {
		await expect(async () => {
			await app.workbench.positronNotebooks.addCodeToFirstCell('eval("8**2")');
			await app.workbench.positronNotebooks.executeCodeInCell();

			expect(await app.workbench.positronNotebooks.getPythonCellOutput()).toBe('64');
		}).toPass({ timeout: 120000 });
	});

	test('Python - Basic notebook creation and execution (markdown) [C628632]', async function ({ app }) {
		const randomText = Math.random().toString(36).substring(7);

		await app.workbench.notebook.insertNotebookCell('markdown');
		await app.workbench.notebook.waitForTypeInEditor(`## ${randomText} `);
		await app.workbench.notebook.stopEditingCell();

		expect(await app.workbench.positronNotebooks.getMarkdownText(`h2 >> text="${randomText}"`)).toBe(randomText);
	});

	test('Dummy test - will not restart', async function ({ app }) {
		const randomText = Math.random().toString(36).substring(7);

		await app.workbench.notebook.insertNotebookCell('markdown');
		await app.workbench.notebook.waitForTypeInEditor(`## ${randomText} `);
		await app.workbench.notebook.stopEditingCell();

		expect(await app.workbench.positronNotebooks.getMarkdownText(`h2 >> text="${randomText}"`)).toBe(randomText);
	});
});
