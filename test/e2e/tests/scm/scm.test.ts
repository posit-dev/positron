/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

test.describe('Source Content Management', {
	tag: [tags.SCM, tags.WEB, tags.WIN]
}, () => {

	test.afterAll(async function ({ cleanup }) {
		await cleanup.discardAllChanges();
	});

	test('Verify SCM Tracks File Modifications, Staging, and Commit Actions', async function ({ app, openFile }) {

		const file = 'chinook-sqlite.py';
		await test.step('Open file and add a new line to it', async () => {
			await openFile(join('workspaces', 'chinook-db-py', file));

			await app.positron.editor.clickOnTerm(file, 'rows', 9, true);

			await app.code.driver.page.keyboard.press('ArrowRight');
			await app.code.driver.page.keyboard.press('ArrowRight');
			await app.code.driver.page.keyboard.type('\n');

			await app.code.driver.page.keyboard.type('print(df)');

			await app.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');

		});

		await test.step('Open scm viewer and await change appearance', async () => {
			await app.positron.scm.openSCMViewlet();

			await app.positron.scm.waitForChange(file, 'Modified');
		});

		await test.step('Open change and await tab appearance', async () => {
			await app.positron.scm.openChange(file);

			await app.positron.sideBar.closeSecondarySideBar();

			await app.positron.editors.waitForSCMTab(`${file} (Working Tree)`);

			await app.positron.layouts.enterLayout('stacked');
		});

		await test.step('Stage, commit change, and verify history', async () => {
			const message = 'Add print statement';

			await app.positron.scm.stage(file);

			await app.positron.scm.commit(message);

			// This works locally but not in CI where we have no
			// git user for a real commit to take place:
			// await app.workbench.scm.verifyCurrentHistoryItem(message);
		});
	});
});
