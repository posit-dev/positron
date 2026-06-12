/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../../_test.setup';
import { test } from '../_test.setup.js';

const LANGUAGES = [
	{ lang: 'Python', target: 'notebook.python' },
	{ lang: 'R', target: 'notebook.r' },
] as const;

function parseVersion(text: string | null | undefined): string | undefined {
	return text?.match(/[\d.]+/)?.[0];
}

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Kernel Startup', {
	tag: [tags.WIN, tags.POSITRON_NOTEBOOKS, tags.SESSIONS, tags.PERFORMANCE]
}, () => {

	test.afterEach(async function ({ sessions }) {
		await sessions.deleteAll();
	});

	for (const { lang, target } of LANGUAGES) {
		test(`Notebook Kernel Start: ${lang}`, async function ({ app, metric }) {
			const { notebooksPositron } = app.workbench;

			// Fresh untitled Positron notebook so kernel startup happens under test control.
			await notebooksPositron.createNewNotebook();
			await notebooksPositron.expectToBeVisible();

			const { duration_ms } = await metric.sessions.start(async () => {
				await notebooksPositron.kernel.select(lang, { waitForReady: true });
			}, target, {
				language: lang,
				description: `Notebook: ${lang} kernel start`,
				additionalContext: async () => ({
					runtime_version: parseVersion(await notebooksPositron.kernel.statusBadge.textContent()),
				}),
			});

			expect(duration_ms).toBeGreaterThan(0);
			if (!process.env.CI) { console.log(`[perf] start_session ${target}: ${duration_ms} ms`); }
		});
	}
});
