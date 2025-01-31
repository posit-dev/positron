/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application } from '../../infra';
import { test, tags } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

test.describe('References', {
	tag: [tags.REFERENCES, tags.WEB, tags.WIN]
}, () => {

	test.afterEach(async ({ app, runCommand }) => {

		await app.workbench.references.close();
		await runCommand('workbench.action.closeAllEditors');

	});

	test('Python - Verify References Functionality', async function ({ app, python, openFile }) {
		const helper = 'helper.py';

		await openFile(join('workspaces', 'references_tests', 'python', helper));

		await openAndCommonValidations(app, helper);

		await test.step('Verify reference files', async () => {
			await app.workbench.references.waitForReferenceFiles(['main.py', 'another_script.py', helper]);
		});

	});


	test('R - Verify References Functionality', async function ({ app, r, openFile }) {
		const helper = 'helper.R';

		await openFile(join('workspaces', 'references_tests', 'r', helper));

		await openAndCommonValidations(app, helper);

		await test.step('Verify reference files', async () => {
			await app.workbench.references.waitForReferenceFiles(['main.R', 'another_script.R', helper]);
		});
	});

});

async function openAndCommonValidations(app: Application, helper: string) {

	await expect(async () => {
		await app.workbench.editor.clickOnTerm(helper, 'add', 1, true);

		await test.step('Open references view', async () => {
			await app.code.driver.page.keyboard.press('F12');

			await app.workbench.references.waitUntilOpen();
		});
	}).toPass({ timeout: 60000 });

	await test.step('Verify title references count', async () => {
		await app.workbench.sideBar.closeSecondarySideBar();

		await app.workbench.references.waitForReferencesCountInTitle(4);

		await app.workbench.layouts.enterLayout('stacked');
	});

	await test.step('Verify references count', async () => {
		await app.workbench.references.waitForReferencesCount(1);
	});

	await test.step('Verify references file', async () => {
		await app.workbench.references.waitForFile(helper);
	});

}
