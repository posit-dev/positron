/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

test.describe('SCM', {
	tag: [tags.SCM, tags.WEB, tags.WIN]
}, () => {

	test('Verify SCM Functionality', async function ({ app, openFile }) {

		const file = 'chinook-sqlite.py';
		await test.step('Open file and add a new line to it', async () => {
			await openFile(join('workspaces', 'chinook-db-py', file));

			await app.workbench.editor.clickOnTerm(file, 'rows', 9, true);

			await app.code.driver.page.keyboard.press('ArrowRight');
			await app.code.driver.page.keyboard.press('ArrowRight');
			await app.code.driver.page.keyboard.type('\n');

			await app.code.driver.page.keyboard.type('print(df)');

			await app.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');

		});

		await test.step('Open scm vieweer and await change appearance', async () => {
			await app.workbench.scm.openSCMViewlet();

			await app.workbench.scm.waitForChange(file, 'Modified');
		});

		await test.step('Open change and await tab appearance', async () => {
			await app.workbench.scm.openChange(file);

			await app.workbench.sideBar.closeSecondarySideBar();

			await app.workbench.editors.waitForSCMTab(`${file} (Working Tree)`);

			await app.workbench.layouts.enterLayout('stacked');
		});

		const message = 'Add print statement';
		await test.step('Stage, commit change, and verify history', async () => {
			await app.workbench.scm.stage(file);

			await app.workbench.scm.commit(message);

			await app.workbench.scm.verifyCurrentHistoryItem(message);
		});


	});
});
