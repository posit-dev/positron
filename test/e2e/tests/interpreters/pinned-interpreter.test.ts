/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
A pinned interpreter starts in place of the interpreter the folder used last (#2659).

`python.defaultInterpreterPath` names the pin. The folder's affiliated runtime is the
Python whose console was in front last. On the next open, Positron writes the pin over
it, so the pinned Python starts instead. `app.restart()` opens the folder again; the old
consoles stop when Positron closes, so there's nothing to reconnect to.
*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Pinned Interpreter', {
	tag: [tags.INTERPRETER, tags.PYTHON]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'interpreters.startupBehavior': 'auto',
			// test-files has R files, so R's recommendation would start R too.
			'[r]': { 'interpreters.startupBehavior': 'manual' },
		});
	});

	// The fixtures hold the window from before `app.restart()`, so use `app.workbench` after it.
	test.afterAll(async function ({ app }) {
		await app.workbench.userSettings.remove(['python.defaultInterpreterPath', '[r]']);
		await app.workbench.userSettings.set({ 'interpreters.startupBehavior': 'manual' });
	});

	test('Python - the pinned interpreter starts in place of the one used last', async function ({ app, sessions, settings }) {
		test.slow();
		const pinned = await sessions.start('pythonAlt');

		await test.step('Pin one Python, and use the other one last', async () => {
			// The Python that starts last is the one the folder used last.
			await settings.set({ 'python.defaultInterpreterPath': pinned.path });
			await sessions.start('python');
		});

		await test.step('Open the folder again', async () => {
			await app.restart();
		});

		const { sessions: sessionsAfterRestart } = app.workbench;
		await sessionsAfterRestart.expectSessionCountToBe(1);
		// The start reason shows the pin chose this Python, not the folder's last one.
		const { name, startReasonId } = await sessionsAfterRestart.getMetadata();
		expect({ name, startReasonId }).toEqual({ name: pinned.name, startReasonId: 'pinnedRuntime' });
	});
});
