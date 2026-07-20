/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { deletePositronHistoryFiles } from './helpers/default-interpreters.js';

test.use({
	suiteId: __filename
});

// electron only for now - windows doesn't have hidden interpreters and for web the deletePositronHistoryFiles is not valid
test.describe('Default Interpreters - R', {
	tag: [tags.INTERPRETER, tags.ARK]
}, () => {

	test.beforeAll(async function ({ settings }) {

		await settings.remove(['interpreters.startupBehavior']);
		await settings.set({ 'interpreters.startupBehavior': 'always' });

		await deletePositronHistoryFiles();

		// local debugging sample:
		// await settings.set({'positron.r.interpreters.default': '/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources/R'}, { reload: true });

		const hiddenRVersion = process.env.POSITRON_HIDDEN_R;
		if (!hiddenRVersion) {
			throw new Error('POSITRON_HIDDEN_R environment variable is not set');
		}

		const rPath = `/root/scratch/R-${hiddenRVersion}/bin/R`;

		await settings.set({ 'positron.r.interpreters.default': rPath }, { reload: true });

	});

	test.afterAll(async function ({ cleanup }) {

		await cleanup.discardAllChanges();

	});

	test('R - Add a default interpreter', async function ({ sessions, hotKeys }) {

		const hiddenRVersion = process.env.POSITRON_HIDDEN_R;
		if (!hiddenRVersion) {
			throw new Error('POSITRON_HIDDEN_R environment variable is not set');
		}

		// Escape dots for regex matching
		const escapedVersion = hiddenRVersion.replace(/\./g, '\\.');

		// The beforeAll set the default interpreter and reloaded in one call. That reload cancels
		// the in-flight (extension-requested) session creation, and the affiliated runtime does not
		// reliably auto-start afterward. Wait for a session to actually appear before reading
		// metadata rather than racing a still-empty console (which is what surfaced the misleading
		// "Extract session metadata" timeout). If affiliation never fired, reload once to re-trigger
		// it -- but only after the wait, so we never reload a session mid-start (a reload cancels
		// in-flight session creation; see #14901).
		try {
			await sessions.expectSessionCountToBe(1);
		} catch {
			await hotKeys.reloadWindow(true);
			await sessions.expectSessionCountToBe(1);
		}

		const { name, path } = await sessions.getMetadata();

		// Local debugging sample:
		// expect(name).toContain('R 4.3.3');
		// expect(path).toContain('R.framework/Versions/4.3-arm64/Resources/R');

		// hidden CI interpreter:
		expect(name).toMatch(new RegExp(`R ${escapedVersion}`));
		expect(path).toMatch(new RegExp(`R-${escapedVersion}\\/bin\\/R`));
	});
});
