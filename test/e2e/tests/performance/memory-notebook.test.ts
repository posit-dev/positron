/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

// Runs against a Python session, so the interesting figure is this scenario minus
// session-python, not minus idle: what the notebook editor and its renderer path
// cost on top of a session that already exists. The cross-scenario summary deltas
// everything against idle today, so that subtraction is by eye until #15495.
defineMemoryScenario({
	scenario: 'notebook',
	prepare: async ({ app }) => {
		const { notebooks, notebooksPositron } = app.workbench;

		await notebooks.createNewNotebook();

		// Fails loudly if `positron.notebook.enabled` ever stops defaulting to true.
		// This scenario exists to measure the Positron notebook editor, and the legacy
		// one would publish a different app state under the same series name. Asserted
		// rather than pinned in settingsMemory.json, which is shared with idle and
		// would move the idle baseline.
		await notebooksPositron.expectToBeVisible();

		// Selected explicitly because settingsMemory.json pins startup behavior to
		// manual for every memory scenario, so nothing auto-starts. waitForReady
		// defaults on, which is the settle point before the collector takes over.
		await notebooksPositron.kernel.select('Python');
		await notebooksPositron.addCodeToCell(0, 'print("hello")', { run: true });

		// Output present, not just a cell that stopped spinning: a cell can finish
		// without ever having rendered anything, and the renderer path is the point.
		await notebooksPositron.expectOutputAtIndex(0, ['hello']);
	},
	// Same gate as session-python: kernel only exists once a session really started,
	// so it is what stops a failed run from publishing an idle-shaped number.
	expectRoles: ['kernel', 'kernel_supervisor']
});
