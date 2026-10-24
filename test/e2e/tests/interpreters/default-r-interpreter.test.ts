/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { deletePositronHistoryFiles } from './helpers/default-interpreters.js';

test.use({
	suiteId: __filename
});

/** The hidden CI R version, and the path of its R binary. */
function hiddenR(): { version: string; path: string; escapedVersion: string } {
	const version = process.env.POSITRON_HIDDEN_R;
	if (!version) {
		throw new Error('POSITRON_HIDDEN_R environment variable is not set');
	}
	// local debugging sample: '/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources/R'
	return { version, path: `/root/scratch/R-${version}/bin/R`, escapedVersion: version.replace(/\./g, '\\.') };
}

// electron only for now - windows doesn't have hidden interpreters and for web the deletePositronHistoryFiles is not valid
test.describe('Default Interpreters - R', {
	tag: [tags.INTERPRETER, tags.ARK]
}, () => {

	test.describe('always start for all languages', () => {

		test.beforeAll(async function ({ settings }) {
			await settings.remove(['interpreters.startupBehavior']);
			await settings.set({ 'interpreters.startupBehavior': 'always' });

			await deletePositronHistoryFiles();

			await settings.set({ 'positron.r.interpreters.default': hiddenR().path }, { reload: true });
		});

		test('R - The default R and the Python recommendation both start in a folder with R and Python files', async function ({ sessions, hotKeys }) {
			// The folder has R and Python files. The default R starts right away in a folder that
			// looks like an R project, and so does Python's recommendation, so both consoles start.
			//
			// The beforeAll set the default interpreter and reloaded in one call. That reload cancels
			// the in-flight (extension-requested) session creation, so a session may not appear.
			// Wait for both before reading them, and reload once if they don't appear -- but only
			// after the wait, so we never reload a session mid-start (see #14901).
			try {
				await sessions.expectSessionCountToBe(2);
			} catch {
				await hotKeys.reloadWindow(true);
				await sessions.expectSessionCountToBe(2);
			}

			const names = (await sessions.getActiveSessions()).map(session => session.name);
			expect(names.find(name => name.startsWith('R '))).toMatch(new RegExp(`R ${hiddenR().escapedVersion}`));
			expect(names.some(name => name.startsWith('Python '))).toBe(true);
		});
	});

	test.describe('always start for R only', () => {

		test.beforeAll(async function ({ settings }) {
			await settings.remove(['interpreters.startupBehavior']);
			await settings.set({
				'[r]': { 'interpreters.startupBehavior': 'always' },
				'positron.r.interpreters.default': hiddenR().path,
			}, { reload: true });
		});

		test('R - Add a default interpreter', async function ({ sessions }) {
			// A language-specific `always` starts R even when another language's console is
			// already running, so R is one of the sessions rather than the only one.
			const { escapedVersion } = hiddenR();

			// R starts after interpreter discovery; allow as long as `expectSessionCountToBe` does.
			await expect(async () => {
				const r = (await sessions.getActiveSessions()).find(session => session.name.startsWith('R '));
				expect(r?.name).toMatch(new RegExp(`R ${escapedVersion}`));
				expect(r?.path).toMatch(new RegExp(`R-${escapedVersion}\\/bin\\/R`));
			}).toPass({ timeout: 45000 });
		});
	});
});
