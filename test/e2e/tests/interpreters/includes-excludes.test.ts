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
			'positron.r.customRootFolders': [buildRPath('include')]
		}, { reload: true });
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
		overridePythonPath = buildPythonPath('override');
		overrideRPath = buildRPath('override');

		await settings.set({
			'python.interpreters.override': [overridePythonPath],
			'positron.r.interpreters.override': [overrideRPath]
		}, { reload: true });
	});

	test('R - Can Override Interpreter Discovery', { tag: [tags.ARK] }, async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'r', overrideRPath);
	});

	test('Python - Can Override Interpreter Discovery', async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'python', overridePythonPath);
	});
});
