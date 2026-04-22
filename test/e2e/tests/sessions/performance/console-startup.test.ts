/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../../_test.setup';

test.use({
	suiteId: __filename
});

const LANGUAGES = [
	{ lang: 'Python', runtime: 'python', target: 'console.python' },
	{ lang: 'R', runtime: 'r', target: 'console.r' },
] as const;

function parseVersion(text: string | null | undefined): string | undefined {
	return text?.match(/[\d.]+/)?.[0];
}

test.describe('Sessions: Console Startup', {
	tag: [tags.WIN, tags.SESSIONS, tags.PERFORMANCE]
}, () => {

	test.afterEach(async function ({ hotKeys, sessions }) {
		await hotKeys.closeAllEditors();
		await sessions.deleteAll();
	});

	for (const { lang, runtime, target } of LANGUAGES) {
		test(`Console Start: ${lang}`, async function ({ sessions, metric }) {
			let sessionName = '';

			const { duration_ms } = await metric.sessions.start(async () => {
				const info = await sessions.start(runtime, { reuse: false });
				sessionName = info.name;
			}, target, {
				language: lang,
				description: `Console: ${lang} start`,
				additionalContext: async () => ({ runtime_version: parseVersion(sessionName) }),
			});

			if (!process.env.CI) { console.log(`[perf] start_session ${target}: ${duration_ms} ms`); }
		});
	}
});
