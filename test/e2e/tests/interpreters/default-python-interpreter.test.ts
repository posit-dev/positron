/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { deletePositronHistoryFiles } from './helpers/default-interpreters.js';
import { buildPythonPath } from './helpers/include-excludes.js';
import path from 'path';

test.use({
	suiteId: __filename
});

// electron only for now - windows doesn't have hidden interpreters and for web the deletePositronHistoryFiles is not valid
test.describe('Default Interpreters - Python', {
	tag: [tags.INTERPRETER]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({ 'interpreters.startupBehavior': 'always' });
		await deletePositronHistoryFiles();

		// Build environment-aware path for default interpreter
		// Note: CI uses hidden Python in /root/scratch, local uses pyenv version
		const pythonVersion = process.env.POSITRON_PY_VER_SEL || '3.10.12';
		const pythonPath = process.env.CI
			? `${buildPythonPath('include')}/bin/python` // Hidden Python (POSITRON_HIDDEN_PY)
			: path.join(process.env.HOME || '', `.pyenv/versions/${pythonVersion}/bin/python`);

		// Reload to both apply the settings and trigger the default-interpreter auto-start:
		// 'always' only recognizes defaultInterpreterPath once the app's initial interpreter
		// discovery has already run once, so this reload must come after normal app boot rather
		// than moving the settings to a pre-launch beforeApp fixture.
		await settings.set({ 'python.defaultInterpreterPath': pythonPath }, { reload: true, waitForReady: true });
	});

	test.afterAll(async function ({ cleanup }) {
		await cleanup.discardAllChanges();
	});

	test('Python - Add a default interpreter (Conda)', async function ({ sessions, hotKeys }) {
		// Get version from appropriate env var (hidden Python in CI, regular in local)
		const pythonVersion = process.env.CI
			? (process.env.POSITRON_HIDDEN_PY || '3.12.10').split(' ')[0] // Extract "3.12.10" from "3.12.10 (Conda)"
			: process.env.POSITRON_PY_VER_SEL || '3.10.12';

		// Match version with optional text after (e.g., "Python 3.12.10 (Conda)")
		const versionRegex = new RegExp(`Python ${pythonVersion.replace(/\./g, '\\.')}(\\s.*)?`);

		// Build environment-aware path regex
		const pathRegex = process.env.CI
			? /python-env\/bin\/python/
			: new RegExp(`~?\\.pyenv/versions/${pythonVersion.replace(/\./g, '\\.')}/bin/python`);

		// The beforeAll set python.defaultInterpreterPath and reloaded in one call. That reload
		// cancels the in-flight (extension-requested) session creation, and the affiliated Python
		// runtime does not reliably auto-start afterward. Wait for a session to actually appear
		// before reading metadata rather than racing a still-empty console (which is what surfaced
		// the misleading "Extract session metadata" timeout). If affiliation never fired, reload
		// once to re-trigger it -- but only after the wait, so we never reload a session mid-start
		// (a reload cancels in-flight session creation; see #14901).
		try {
			await sessions.expectSessionCountToBe(1);
		} catch {
			await hotKeys.reloadWindow(true);
			await sessions.expectSessionCountToBe(1);
		}

		const { name, path } = await sessions.getMetadata();
		expect(name).toMatch(versionRegex);
		expect(path).toMatch(pathRegex);
	});
});
