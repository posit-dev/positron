/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Hotkeys } from '../../infra';
import { test, tags } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

test.describe('Source Content Management', {
	tag: [tags.SCM, tags.WEB, tags.WIN]
}, () => {

	test('Verify SCM Tracks File Modifications, Staging, and Commit Actions', async function ({ app, openFile, keyboard }) {

		const file = 'chinook-sqlite.py';
		await test.step('Open file and add a new line to it', async () => {
			await openFile(join('workspaces', 'chinook-db-py', file));

			await app.workbench.editor.clickOnTerm(file, 'rows', 9, true);

			await app.code.driver.page.keyboard.press('ArrowRight');
			await app.code.driver.page.keyboard.press('ArrowRight');
			await app.code.driver.page.keyboard.type('\n');

			await app.code.driver.page.keyboard.type('print(df)');

			await keyboard.hotKeys(Hotkeys.SAVE);

		});

		await test.step('Open scm viewer and await change appearance', async () => {
			await app.workbench.scm.openSCMViewlet();

			await app.workbench.scm.waitForChange(file, 'Modified');
		});

		await test.step('Open change and await tab appearance', async () => {
			await app.workbench.scm.openChange(file);

			await app.workbench.sideBar.closeSecondarySideBar();

			await app.workbench.editors.waitForSCMTab(`${file} (Working Tree)`);

			await app.workbench.layouts.enterLayout('stacked');
		});

		await test.step('Stage, commit change, and verify history', async () => {
			const message = 'Add print statement';

			await app.workbench.scm.stage(file);

			await app.workbench.scm.commit(message);

			// This works locally but not in CI where we have no
			// git user for a real commit to take place:
			// await app.workbench.scm.verifyCurrentHistoryItem(message);
		});
	});
});
