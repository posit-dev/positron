/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

test.describe('Problems', {
	tag: [tags.PROBLEMS, tags.WEB, tags.WIN]
}, () => {

	test('Python - Verify Problems Functionality', async function ({ app, python, openFile }) {
		const problems = app.workbench.problems;

		await test.step('Open file and replace "rows" on line 9 with exclamation point', async () => {
			await openFile(join('workspaces', 'chinook-db-py', 'chinook-sqlite.py'));

			await app.workbench.editor.clickOnTerm('chinook-sqlite.py', 'rows', 9, true);

			await app.code.driver.page.keyboard.type('!');
		});

		await test.step('Verify File Squiggly', async () => {
			await expect(problems.errorSquiggly).toBeVisible();
		});

		await app.workbench.problems.showProblemsView();

		await test.step('Verify Problems Count', async () => {
			await expect(async () => {
				const errorLocators = await problems.problemsViewError.all();
				expect(errorLocators.length).toBe(4);
			}).toPass({ timeout: 20000 });
		});

		await test.step('Revert error', async () => {
			await app.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
		});

		await test.step('Verify File Squiggly Is Gone', async () => {
			await expect(problems.errorSquiggly).not.toBeVisible();
		});

		await test.step('Verify Problems Count is 0', async () => {
			await expect(async () => {
				expect((await problems.problemsViewError.all()).length).toBe(0);
			}).toPass({ timeout: 20000 });
		});

	});

	test('R - Verify Problems Functionality', async function ({ app, r, openFile }) {
		const problems = app.workbench.problems;

		await test.step('Open file and replace "albums" on line 5 with exclamation point', async () => {
			await openFile(join('workspaces', 'chinook-db-r', 'chinook-sqlite.r'));

			await app.workbench.editor.clickOnTerm('chinook-sqlite.r', 'albums', 5, true);

			await app.code.driver.page.keyboard.type('!');
		});

		await test.step('Verify File Squiggly', async () => {
			await expect(problems.errorSquiggly).toBeVisible();
		});

		await app.workbench.problems.showProblemsView();

		await test.step('Verify Problems Count', async () => {
			expect((await problems.problemsViewError.all()).length).toBe(1);
		});

		await test.step('Revert error', async () => {
			await app.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');

		});

		await test.step('Verify File Squiggly Is Gone', async () => {
			await expect(problems.errorSquiggly).not.toBeVisible();
		});

		await test.step('Verify Problems Count is 0', async () => {
			await expect(async () => {
				expect((await problems.problemsViewError.all()).length).toBe(0);
			}).toPass({ timeout: 20000 });
		});

	});
});
