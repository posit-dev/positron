/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Startup Performance', {
	tag: [tags.WIN, tags.SESSIONS, tags.PERFORMANCE]
}, () => {

	test.afterEach(async function ({ hotKeys, sessions }) {
		await hotKeys.closeAllEditors();
		await sessions.deleteDisconnectedSessions();
	});

	test('Console Start: Python', async function ({ sessions, metric }) {
		// `reuse: false` forces a fresh create path rather than piggybacking on an existing idle session.
		const { duration_ms } = await metric.sessions.start(async () => {
			await sessions.start('python', { reuse: false });
		}, 'session.python', {
			sessionMode: 'console',
			language: 'Python',
			description: 'Console: Python start (picker to idle)',
		});

		if (!process.env.CI) { console.log(`[perf] session.start console python: ${duration_ms} ms`); }
	});

	test('Notebook Start: Python', async function ({ app, settings, metric }) {
		const { notebooks, notebooksPositron } = app.workbench;

		// tests/sessions/ does not enable Positron notebooks by default, so opt in here.
		await notebooksPositron.enablePositronNotebooks(settings);

		// Fresh untitled Positron notebook so kernel startup happens under test control.
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();

		const { duration_ms } = await metric.sessions.start(async () => {
			await notebooksPositron.kernel.select('Python', { waitForReady: true });
		}, 'session.python', {
			sessionMode: 'notebook',
			language: 'Python',
			description: 'Notebook: Python kernel start (select to idle)',
		});

		if (!process.env.CI) { console.log(`[perf] session.start notebook python: ${duration_ms} ms`); }
	});

	test('Console Start: R', async function ({ sessions, metric }) {
		// `reuse: false` forces a fresh create path rather than piggybacking on an existing idle session.
		const { duration_ms } = await metric.sessions.start(async () => {
			await sessions.start('r', { reuse: false });
		}, 'session.r', {
			sessionMode: 'console',
			language: 'R',
			description: 'Console: R start (picker to idle)',
		});

		if (!process.env.CI) { console.log(`[perf] session.start console r: ${duration_ms} ms`); }
	});

	test('Notebook Start: R', async function ({ app, settings, metric }) {
		const { notebooks, notebooksPositron } = app.workbench;

		// tests/sessions/ does not enable Positron notebooks by default, so opt in here.
		await notebooksPositron.enablePositronNotebooks(settings);

		// Fresh untitled Positron notebook so kernel startup happens under test control.
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();

		const { duration_ms } = await metric.sessions.start(async () => {
			await notebooksPositron.kernel.select('R', { waitForReady: true });
		}, 'session.r', {
			sessionMode: 'notebook',
			language: 'R',
			description: 'Notebook: R kernel start (select to idle)',
		});

		if (!process.env.CI) { console.log(`[perf] session.start notebook r: ${duration_ms} ms`); }
	});
});
