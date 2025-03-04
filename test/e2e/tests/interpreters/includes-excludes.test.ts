/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { InterpreterType } from '../../infra/fixtures/interpreter';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// export POSITRON_HIDDEN_PY='3.12.7'
// export POSITRON_HIDDEN_R='4.2.3'

test.describe('Interpreter Includes/Excludes', {
	tag: [tags.INTERPRETER]
}, () => {

	test('Python - Can Include an Interpreter', async function ({ app, python, userSettings }) {

		await userSettings.set([['python.interpreters.include', '["/home/runner/scratch/python-env"]']], true);

		const hiddenPython = process.env.POSITRON_HIDDEN_PY;

		if (hiddenPython) {
			await app.workbench.interpreter.selectInterpreter(InterpreterType.Python, hiddenPython, true);
		} else {
			fail('Hidden Python version not set');
		}
	});

	test('R - Can Include an Interpreter', async function ({ app, r, userSettings }) {

		await userSettings.set([['positron.r.customRootFolders', '["/home/runner/scratch"]']], true);

		const hiddenR = process.env.POSITRON_HIDDEN_R;

		if (hiddenR) {
			await app.workbench.interpreter.selectInterpreter(InterpreterType.R, hiddenR, true);
		} else {
			fail('Hidden R version not set');
		}
	});
});
