/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

// Separate from session-python rather than one scenario starting both. label.ts
// maps ipykernel_launcher and ark to a single `kernel` role, and both extensions
// load their session code into the same extension host heap, so a combined run
// could not tell an R-side regression from a Python-side one.
defineMemoryScenario({
	scenario: 'session-r',
	prepare: async ({ sessions }) => {
		await sessions.startAndSkipMetadata({ language: 'R', waitForReady: true });
	},
	expectRoles: ['kernel', 'kernel_supervisor']
});
