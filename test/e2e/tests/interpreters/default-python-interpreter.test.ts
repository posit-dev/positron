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
	tag: [tags.INTERPRETER]
}, () => {

	test.beforeAll(async function ({ settings }) {

		await settings.remove(['interpreters.startupBehavior']);
		await settings.set({ 'interpreters.startupBehavior': 'always' });

		await deletePositronHistoryFiles();

		// local debugging sample:
		// const homeDir = process.env.HOME || '';
		// await settings.set({'python.defaultInterpreterPath': `${path.join(homeDir, '.pyenv/versions/3.13.0/bin/python')}`}, { reload: true });

		const pythonPath = '/root/scratch/python-env/bin/python';

		await settings.set({ 'python.defaultInterpreterPath': pythonPath }, { reload: true });

	});

	test.afterAll(async function ({ cleanup }) {

		await cleanup.discardAllChanges();

	});

	test('Python - Add a default interpreter (Conda)', async function ({ runCommand, sessions }) {

		await runCommand('workbench.action.reloadWindow');

		await expect(async () => {

			try {
				const { name, path } = await sessions.getMetadata();

				// Local debugging sample:
				// expect(name).toMatch(/Python 3\.13\.0/);
				// expect(path).toMatch(/.pyenv\/versions\/3.13.0\/bin\/python/);

				// hidden CI interpreter:
				expect(name).toMatch(/Python 3\.12\.10/);
				expect(path).toMatch(/python-env\/bin\/python/);

			} catch (error) {
				await runCommand('workbench.action.reloadWindow');
				throw error;
			}

		}).toPass({ timeout: 60000 });
	});
});
