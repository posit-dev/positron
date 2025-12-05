/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
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
		const pythonVersion = process.env.POSITRON_PY_VER_SEL || '3.10.12';
		const pythonPath = process.env.CI
			? `${buildPythonPath('include')}/bin/python`
			: path.join(process.env.HOME || '', `.pyenv/versions/${pythonVersion}/bin/python`);

		// First reload: "Apply these settings"
		await settings.set({ 'python.defaultInterpreterPath': pythonPath }, { reload: true });
	});

	test.afterAll(async function ({ cleanup }) {
		await cleanup.discardAllChanges();
	});

	test('Python - Add a default interpreter (Conda)', async function ({ hotKeys, sessions }) {
		// Second reload: "Now actually start the interpreter with these settings"
		await hotKeys.reloadWindow(true);

		// Get version from environment and create regex patterns
		const pythonVersion = process.env.POSITRON_PY_VER_SEL || '3.10.12';
		const versionRegex = new RegExp(`Python ${pythonVersion.replace(/\./g, '\\.')}`);

		// Build environment-aware path regex
		const pathRegex = process.env.CI
			? /python-env\/bin\/python/
			: new RegExp(`~?\\.pyenv/versions/${pythonVersion.replace(/\./g, '\\.')}/bin/python`);

		const { name, path } = await sessions.getMetadata();

		expect(name).toMatch(versionRegex);
		expect(path).toMatch(pathRegex);
	});
});
