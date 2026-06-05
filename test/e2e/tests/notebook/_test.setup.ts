/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, TestFixtures, WorkerFixtures } from '../_test.setup';

interface NotebookTestFixtures extends TestFixtures {
}

interface NotebookWorkerFixtures extends WorkerFixtures {
	useLegacyNotebookEditor: boolean;
}

export const test = base.extend<NotebookTestFixtures, NotebookWorkerFixtures>({
	useLegacyNotebookEditor: [true, { scope: 'worker', option: true }],

	beforeApp: [
		async ({ useLegacyNotebookEditor, settingsFile }, use) => {
			if (useLegacyNotebookEditor) {
				// These tests exercise the legacy (VS Code) notebook editor. The
				// Positron notebook editor is now the default, so disable it before
				// the app starts to avoid waiting for a window reload.
				settingsFile.append({ 'positron.notebook.enabled': false });
			}

			await use();
		},

		{ scope: 'worker' }
	],
});
