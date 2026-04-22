/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const LANGUAGES = [
	{ lang: 'Python', runtime: 'python', target: 'session.python' },
	{ lang: 'R', runtime: 'r', target: 'session.r' },
] as const;

function parseVersion(text: string | null | undefined): string | undefined {
	return text?.match(/[\d.]+/)?.[0];
}

test.describe('Sessions: Startup Performance', {
	tag: [tags.WIN, tags.SESSIONS, tags.PERFORMANCE]
}, () => {

	test.afterEach(async function ({ hotKeys, sessions }) {
		await hotKeys.closeAllEditors();
		await sessions.deleteDisconnectedSessions();
	});

	for (const { lang, runtime, target } of LANGUAGES) {
		test(`Console Start: ${lang}`, async function ({ sessions, metric }) {
			// `reuse: false` forces a fresh create path rather than piggybacking on an existing idle session.
			let sessionName = '';
			const { duration_ms } = await metric.sessions.start(async () => {
				const info = await sessions.start(runtime, { reuse: false });
				sessionName = info.name;
			}, target, {
				sessionMode: 'console',
				language: lang,
				description: `Console: ${lang} start (picker to idle)`,
				additionalContext: async () => ({ runtime_version: parseVersion(sessionName) }),
			});

			if (!process.env.CI) { console.log(`[perf] session.start console ${runtime}: ${duration_ms} ms`); }
		});

		test(`Notebook Start: ${lang}`, async function ({ app, settings, metric }) {
			const { notebooks, notebooksPositron } = app.workbench;

			// tests/sessions/ does not enable Positron notebooks by default, so opt in here.
			await notebooksPositron.enablePositronNotebooks(settings);

			// Fresh untitled Positron notebook so kernel startup happens under test control.
			await notebooks.createNewNotebook();
			await notebooksPositron.expectToBeVisible();

			let badgeText: string | null = null;
			const { duration_ms } = await metric.sessions.start(async () => {
				await notebooksPositron.kernel.select(lang, { waitForReady: true });
				badgeText = await notebooksPositron.kernel.statusBadge.textContent();
			}, target, {
				sessionMode: 'notebook',
				language: lang,
				description: `Notebook: ${lang} kernel start (select to idle)`,
				additionalContext: async () => ({ runtime_version: parseVersion(badgeText) }),
			});

			if (!process.env.CI) { console.log(`[perf] session.start notebook ${runtime}: ${duration_ms} ms`); }
		});
	}
});
