/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';

import { PositronPythonFixtures } from '../../../automation';
import { test } from './base-test';

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
});

// describe('Notebooks #pr #web #win', () => {
// 	setupAndStartApp();

// 	describe('R Notebooks', () => {
// 		let app: Application;

// 		before(async function () {
// 			app = this.app as Application;
// 			await PositronRFixtures.SetupFixtures(this.app as Application);
// 		});

// 		beforeEach(async function () {
// 			await app.workbench.positronNotebooks.createNewNotebook();
// 			await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);
// 		});

// 		afterEach(async function () {
// 			await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
// 		});

// 		it('R - Basic notebook creation and execution (code) [C628629]', async function () {
// 			await app.workbench.positronNotebooks.addCodeToFirstCell('eval(parse(text="8**2"))');

// 			await expect(async () => {
// 				await app.workbench.positronNotebooks.executeCodeInCell();
// 				expect(await app.workbench.positronNotebooks.getRCellOutput()).toBe('[1] 64');
// 			}).toPass({ timeout: 60000 });

// 		});

// 		it('R - Basic notebook creation and execution (markdown) [C628630]', async function () {
// 			const randomText = Math.random().toString(36).substring(7);

// 			await app.workbench.notebook.insertNotebookCell('markdown');
// 			await app.workbench.notebook.waitForTypeInEditor(`## ${randomText} `);
// 			await app.workbench.notebook.stopEditingCell();

// 			expect(await app.workbench.positronNotebooks.getMarkdownText(`h2 >> text="${randomText}"`)).toBe(randomText);

// 		});
// 	});
// });
