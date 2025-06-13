/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { deletePositronHistoryFiles } from './helpers/default-interpreters.js';

test.use({
	suiteId: __filename
});

// electron only for now - windows doesn't have hidden interpreters and for web the deletePositronHistoryFiles is not valid
test.describe('Default Interpreters - Python', {
	tag: [tags.INTERPRETER, tags.NIGHTLY_ONLY]
}, () => {

	test.beforeAll(async function ({ app, settings }) {

		await app.workbench.settings.remove(['interpreters.startupBehavior']);

		await deletePositronHistoryFiles();

		// local debugging sample:
		// const homeDir = process.env.HOME || '';
		// await userSettings.set([['python.defaultInterpreterPath', `"${path.join(homeDir, '.pyenv/versions/3.13.0/bin/python')}"`]], true);

		// hidden interpreter (Conda)
		await settings.set({ 'python.defaultInterpreterPath': '/home/runner/scratch/python-env/bin/python' }, { reload: true });

	});

	test.afterAll(async function ({ cleanup }) {

		await cleanup.discardAllChanges();

	});

	test('Python - Add a default interpreter (Conda)', async function ({ app, runCommand, sessions }) {

		await runCommand('workbench.action.reloadWindow');
		await expect(async () => {

			const { name, path } = await sessions.getMetadata();

			// Local debugging sample:
			// expect(name).toMatch(/Python 3\.13\.0/);
			// expect(path).toMatch(/.pyenv\/versions\/3.13.0\/bin\/python/);

			// hidden CI interpreter:
			expect(name).toMatch(/Python 3\.12\.10/);
			expect(path).toMatch(/python-env\/bin\/python/);

		}).toPass({ timeout: 60000 });
	});
});
