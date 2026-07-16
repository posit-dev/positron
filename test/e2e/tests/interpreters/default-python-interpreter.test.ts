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

	test('Python - Add a default interpreter (Conda)', async function ({ sessions }) {
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

		// Verify interpreter metadata. No extra reload here: the beforeAll reload above already
		// starts the interpreter. A second reload used to run at this point, but it raced a
		// window reload against that still-in-flight session-creation call, canceling it and
		// leaving the console referencing a session that never finished starting.
		const { name, path } = await sessions.getMetadata();
		expect(name).toMatch(versionRegex);
		expect(path).toMatch(pathRegex);
	});
});
