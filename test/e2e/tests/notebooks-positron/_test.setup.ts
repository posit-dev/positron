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

	// This overrides the shared beforeApp rather than running after it, so the
	// `extraSettings` handling has to be repeated here.
	beforeApp: [
		async ({ enablePositronNotebooks, extraSettings, settingsFile }, use) => {
			if (enablePositronNotebooks) {
				// Enable Positron notebooks before the app fixture starts
				// to avoid waiting for a window reload
				await settingsFile.append({ 'positron.notebook.enabled': true });
			}
			// Merged last so a suite's own settings win.
			if (Object.keys(extraSettings).length > 0) {
				await settingsFile.append({ ...extraSettings });
			}

			await use();
		},

		{ scope: 'worker' }
	],
});

test.afterEach(async function ({ hotKeys, sessions }) {
	// A focused notebook makes its kernel session the foreground session, so read
	// it before closing. Notebook session ids carry a `-notebook-` marker (see
	// generateNewSessionId in runtimeSession.ts); a console id means the notebook
	// either had no kernel or was not focused, and there is nothing to wait for.
	const foregroundSessionId = await sessions.getForegroundSessionId();

	await hotKeys.closeAllEditors();

	// Closing a notebook shuts its session down asynchronously and the shutdown
	// outlives this hook. Until the session is gone, a new untitled notebook is
	// given the same `Untitled-1.ipynb` URI, binds to the exiting session, and
	// selecting a kernel never starts a fresh one; see
	// https://github.com/posit-dev/positron/issues/16129.
	// Remove this wait once that is fixed.
	if (foregroundSessionId?.includes('-notebook-')) {
		await sessions.expectSessionToBeGone(foregroundSessionId);
	}
});
