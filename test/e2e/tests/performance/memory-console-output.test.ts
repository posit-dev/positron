/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

/**
 * Enough output that retaining it is measurable, and nothing bounds it: the
 * console keeps every line it has ever printed. The only `slice(-N)` limits in
 * positronConsole are on resource-usage history and *input* history, so output
 * history grows for the life of the session.
 */
const LINES = 10_000;

// Runs against a Python session, so the figure of interest is this scenario minus
// session-python: what holding 10k lines of output costs on top of a session that
// already exists. The cross-scenario summary deltas against idle, so that
// subtraction is by eye until #15495.
defineMemoryScenario({
	scenario: 'console-output',
	prepare: async ({ app, sessions }) => {
		const { console } = app.workbench;

		await sessions.startAndSkipMetadata({ language: 'Python', waitForReady: true });

		// One print rather than a loop of 10k prints. Both end up as 10k lines in the
		// console's model, but a loop is 10k separate stream messages over the comm,
		// which is slow enough to risk the scenario timing out for reasons that have
		// nothing to do with memory. The existing console performance spec emits 3000
		// lines the same way.
		//
		// pasteCodeToConsole rather than executeCode: executeCode defaults
		// maximizeConsole to true, and a maximized console is a different layout from
		// the one session-python measured, which would land in this delta as if it
		// were the cost of the output.
		await console.clearInput();
		await console.pasteCodeToConsole(`print("\\n".join(f"scrollback {i}" for i in range(${LINES})))`, true);

		// The last line only exists if every line before it was emitted and rendered,
		// so this is the whole output arriving rather than just some of it. Generous
		// timeout because rendering 10k lines is the slow part and the default 15s is
		// tuned for ordinary assertions.
		await console.waitForConsoleContents(`scrollback ${LINES - 1}`, { timeout: 90_000 });
	},
	// Same gate as session-python: kernel only exists once a session really started,
	// so it is what stops a failed run from publishing an idle-shaped number.
	expectRoles: ['kernel', 'kernel_supervisor']
});
