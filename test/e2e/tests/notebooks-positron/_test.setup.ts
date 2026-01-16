/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, TestFixtures, WorkerFixtures } from '../_test.setup';

interface NotebooksPositronTestFixtures extends TestFixtures {
}

interface NotebooksPositronWorkerFixtures extends WorkerFixtures {
	enablePositronNotebooks: boolean;
}

export const test = base.extend<NotebooksPositronTestFixtures, NotebooksPositronWorkerFixtures>({
	enablePositronNotebooks: [true, { scope: 'worker', option: true }],

	beforeApp: [
		async ({ enablePositronNotebooks, settingsFile }, use) => {
			if (enablePositronNotebooks) {
				// Enable Positron notebooks before the app fixture starts
				// to avoid waiting for a window reload
				settingsFile.append({ 'positron.notebook.enabled': true });
			}

			await use();
		},

		{ scope: 'worker' }
	],
});

test.afterEach(async function ({ hotKeys }) {
	await hotKeys.closeAllEditors();
});
