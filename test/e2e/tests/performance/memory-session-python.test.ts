/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

// startAndSkipMetadata rather than start(): start() opens the console
// information dialog to read metadata, which this scenario does not need and
// which has its own RPC race (#14983). waitForReady is the settle point the
// design asks for; the collector then waits for the tree to stop growing.
//
// Auto-start stays off. settingsMemory.json pins interpreters.startupBehavior to
// manual, so the session measured here is the one this spec asked for, and no R
// session starts alongside it.
defineMemoryScenario({
	scenario: 'session-python',
	prepare: async ({ sessions }) => {
		await sessions.startAndSkipMetadata({ language: 'Python', waitForReady: true });
	},
	// kernel proves a Python kernel is running, kernel_supervisor proves
	// kcserver went from empty to hosting it. Without these the run could
	// publish an idle-shaped number as if the session were free.
	expectRoles: ['kernel', 'kernel_supervisor']
});
