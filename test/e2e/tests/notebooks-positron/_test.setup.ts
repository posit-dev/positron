/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, TestFixtures, WorkerFixtures } from '../_test.setup';

interface NotebooksPositronTestFixtures extends TestFixtures {
}

interface NotebooksPositronWorkerFixtures extends WorkerFixtures {
	enablePositronNotebooks: boolean;
	extraSettings: Record<string, unknown> | undefined;
}

export const test = base.extend<NotebooksPositronTestFixtures, NotebooksPositronWorkerFixtures>({
	enablePositronNotebooks: [true, { scope: 'worker', option: true }],
	extraSettings: [undefined, { scope: 'worker', option: true }],

	beforeApp: [
		async ({ enablePositronNotebooks, extraSettings, settingsFile }, use) => {
			if (enablePositronNotebooks) {
				// Enable Positron notebooks before the app fixture starts
				// to avoid waiting for a window reload
				await settingsFile.append({ 'positron.notebook.enabled': true });
			}
			if (extraSettings) {
				// Suite-specific settings applied before launch (opt in with
				// `test.use({ extraSettings: { ... } })`) to avoid a window reload.
				await settingsFile.append(extraSettings);
			}

			await use();
		},

		{ scope: 'worker' }
	],
});

test.afterEach(async function ({ hotKeys }) {
	await hotKeys.closeAllEditors();
});
