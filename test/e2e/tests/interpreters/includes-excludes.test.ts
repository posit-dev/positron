/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { test, tags } from '../_test.setup';
import { buildPythonPath, buildRPath, expectSessionStartToFail } from './helpers/include-excludes.js';

test.use({
	suiteId: __filename
});

test.describe('Interpreter: Includes', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'python.interpreters.include': [buildPythonPath('include')],
			'positron.r.customRootFolders': [buildRPath('customRoot')]
		}, { reload: true, waitForReady: true });
	});

	test('Python - Can Include an Interpreter', async function ({ sessions }) {
		const hiddenPython = process.env.POSITRON_HIDDEN_PY;

		hiddenPython
			? await sessions.start('pythonHidden')
			: fail('Hidden Python version not set');
	});

	test('R - Can Include an Interpreter', { tag: [tags.ARK] }, async function ({ sessions }) {
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

	test.beforeAll(async function ({ settings }) {
		excludedRPath = buildRPath('exclude');
		excludedPythonPath = buildPythonPath('exclude');

		await settings.set({
			'python.interpreters.exclude': [excludedPythonPath],
			'positron.r.interpreters.exclude': [excludedRPath]
		}, { reload: true, waitForReady: true });
	});

	test('R - Can Exclude an Interpreter', { tag: [tags.ARK] }, async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'rAlt', excludedRPath);
	});

	test('Python - Can Exclude an Interpreter', async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'pythonAlt', excludedPythonPath);
	});
});

// Electron-only. The beforeAll clears the discovery cache and reloads so discovery runs cold
// against the override. This works in Electron because the reload tears down the renderer and
// rebuilds the runtime registry from that cold pass. It cannot fix web/chromium: there the
// Positron server process (and its extension host) survive window reloads, so interpreters
// registered before the override was written stay in the server-side registry no matter what the
// client cache holds. Only a worker restart wipes them, which the harness can't trigger between
// tests. Re-enable @:web once the runtime service unregisters stale entries (see runtimeStartup.ts:996).
test.describe('Interpreter: Override', {
	tag: [tags.INTERPRETER]
}, () => {
	let overrideRPath: string;
	let overridePythonPath: string;

	test.beforeAll(async function ({ app, settings }) {
		overridePythonPath = buildPythonPath('override');
		overrideRPath = buildRPath('override');

		// The discovery cache (StorageScope.APPLICATION) survives window reloads and pre-registers
		// cached runtimes WITHOUT re-validating them against the override setting, so a warm reload
		// with a populated cache can leave a pre-override interpreter registered (its session starts
		// and the test fails). Clear the cache first so the reload below runs discovery cold against
		// the override -- the same state a fresh worker (retry) gets, which is why retries passed.
		await app.workbench.quickaccess.runCommand('Clear Interpreter Cache');

		await settings.set({
			'python.interpreters.override': [overridePythonPath],
			'positron.r.interpreters.override': [overrideRPath]
		}, { reload: true, waitForReady: true });
	});

	test('R - Can Override Interpreter Discovery', { tag: [tags.ARK] }, async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'r', overrideRPath);
	});

	test('Python - Can Override Interpreter Discovery', async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'python', overridePythonPath);
	});
});
