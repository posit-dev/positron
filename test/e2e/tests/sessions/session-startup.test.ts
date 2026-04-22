/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const LANGUAGES = [
	{ lang: 'Python', runtime: 'python', consoleTarget: 'console.python', notebookTarget: 'notebook.python' },
	{ lang: 'R', runtime: 'r', consoleTarget: 'console.r', notebookTarget: 'notebook.r' },
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

	for (const { lang, runtime, consoleTarget, notebookTarget } of LANGUAGES) {
		test(`Console Start: ${lang}`, async function ({ sessions, metric }) {
			let sessionName = '';

			const { duration_ms } = await metric.sessions.start(async () => {
				const info = await sessions.start(runtime, { reuse: false });
				sessionName = info.name;
			}, consoleTarget, {
				language: lang,
				description: `Console: ${lang} start`,
				additionalContext: async () => ({ runtime_version: parseVersion(sessionName) }),
			});

			if (!process.env.CI) { console.log(`[perf] start_session ${consoleTarget}: ${duration_ms} ms`); }
		});

		test(`Notebook Start: ${lang}`, async function ({ app, settings, metric }) {
			const { notebooks, notebooksPositron } = app.workbench;

			await notebooksPositron.enablePositronNotebooks(settings);

			// Fresh untitled Positron notebook so kernel startup happens under test control.
			await notebooks.createNewNotebook();
			await notebooksPositron.expectToBeVisible();

			let badgeText: string | null = null;
			const { duration_ms } = await metric.sessions.start(async () => {
				await notebooksPositron.kernel.select(lang, { waitForReady: true });
				badgeText = await notebooksPositron.kernel.statusBadge.textContent();
			}, notebookTarget, {
				language: lang,
				description: `Notebook: ${lang} kernel start`,
				additionalContext: async () => ({ runtime_version: parseVersion(badgeText) }),
			});

			if (!process.env.CI) { console.log(`[perf] start_session ${notebookTarget}: ${duration_ms} ms`); }
		});
	}
});
