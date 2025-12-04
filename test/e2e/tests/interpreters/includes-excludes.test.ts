/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

/**
 * Helper function to verify that starting a session fails (e.g., when interpreter is excluded).
 * If the session starts successfully, the test will fail.
 */
async function expectSessionStartToFail(
	sessions: any,
	interpreterName: string,
	excludedPath: string
): Promise<void> {
	let sessionStarted = false;
	try {
		await sessions.start(interpreterName, { reuse: false });
		sessionStarted = true;
	} catch (e) {
		// Expected - session should fail to start
	}

	if (sessionStarted) {
		fail(`Expected interpreter to be excluded: ${excludedPath}`);
	}
}

// these are CI only tests; its not recommended to try and get your local machine to run these tests
test.describe('Interpreter: Includes', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {

	test.beforeAll(async function ({ settings }) {
		const basePath = '/root/scratch';

		await settings.set({
			'python.interpreters.include': [`${basePath}/python-env`],
			'positron.r.customRootFolders': [basePath]
		}, { reload: true });
	});

	test('Python - Can Include an Interpreter', async function ({ sessions }) {

		const hiddenPython = process.env.POSITRON_HIDDEN_PY;

		hiddenPython
			? await sessions.start('pythonHidden')
			: fail('Hidden Python version not set');
	});

	test('R - Can Include an Interpreter',
		{ tag: [tags.ARK] }, async function ({ sessions }) {

			const hiddenR = process.env.POSITRON_HIDDEN_R;

			hiddenR
				? await sessions.start('rHidden')
				: fail('Hidden R version not set');
		});
});

test.describe('Interpreter: Excludes', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {
	let excludedRPath: string;
	let excludedPythonPath: string;
	let alternateR: string;
	let alternatePython: string;

	test.beforeAll(async function ({ settings, app }) {
		// setup excluded R paths
		alternateR = process.env.POSITRON_R_ALT_VER_SEL || 'alternate R not set';
		const rMajorMinor = alternateR?.split('.').slice(0, 2).join('.');
		excludedRPath = process.env.CI
			? `/opt/R/${alternateR}`
			: `/Library/Frameworks/R.framework/Versions/${rMajorMinor}-arm64/Resources/bin/R`;

		// setup excluded Python paths
		alternatePython = process.env.POSITRON_PY_ALT_VER_SEL || 'alternate Python not set';
		excludedPythonPath = process.env.CI
			? `~/.pyenv`
			: `/Users/runner/.pyenv/versions/${alternatePython}`;

		// override settings to exclude the alternate interpreters
		await settings.set({
			'python.interpreters.exclude': [excludedPythonPath],
			'positron.r.interpreters.exclude': [excludedRPath]
		}, { reload: true });
	});

	test('R - Can Exclude an Interpreter', { tag: [tags.ARK] }, async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'rAlt', excludedRPath);
	});

	test('Python - Can Exclude an Interpreter', async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'pythonAlt', excludedPythonPath);
	});

});

test.describe('Interpreter: Override', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {
	let overrideRPath: string;
	let overridePythonPath: string;

	test.beforeAll(async function ({ settings }) {
		const alternateR = process.env.POSITRON_R_ALT_VER_SEL || 'alternate R not set';

		overridePythonPath = '/root/scratch/python-env';
		overrideRPath = `/opt/R/${alternateR}/bin/R`;

		await settings.set({
			// 'python.interpreters.override': [overridePythonPath],
			'positron.r.interpreters.override': [overrideRPath]
		}, { reload: true });
	});

	test('R - Can Override Interpreter Discovery', {
		tag: [tags.ARK]
	}, async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'r', overrideRPath);
	});

	test('Python - Can Override Interpreter Discovery', async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'python', overridePythonPath);
	});

});
