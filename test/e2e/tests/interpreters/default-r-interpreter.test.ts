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
test.describe('Default Interpreters - R', {
	tag: [tags.INTERPRETER, tags.ARK]
}, () => {

	test.beforeAll(async function ({ settings }) {

		await settings.remove(['interpreters.startupBehavior']);
		await settings.set({ 'interpreters.startupBehavior': 'always' });

		await deletePositronHistoryFiles();

		// local debugging sample:
		// await settings.set({'positron.r.interpreters.default': '/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources/R'}, { reload: true });

		const rPath = '/root/scratch/R-4.4.1/bin/R';

		await settings.set({ 'positron.r.interpreters.default': rPath }, { reload: true });

	});

	test.afterAll(async function ({ cleanup }) {

		await cleanup.discardAllChanges();

	});

	test('R - Add a default interpreter', async function ({ runCommand, sessions }) {

		await runCommand('workbench.action.reloadWindow');

		await expect(async () => {

			try {
				const { name, path } = await sessions.getMetadata();

				// Local debugging sample:
				// expect(name).toContain('R 4.3.3');
				// expect(path).toContain('R.framework/Versions/4.3-arm64/Resources/R');

				// hidden CI interpreter:
				expect(name).toMatch(/R 4\.4\.1/);
				expect(path).toMatch(/R-4\.4\.1\/bin\/R/);

			} catch (error) {
				await runCommand('workbench.action.reloadWindow');
				throw error;
			}

		}).toPass({ timeout: 60000 });
	});
});
