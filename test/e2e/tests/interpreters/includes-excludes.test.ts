/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InterpreterType } from '../../infra/fixtures/interpreter';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// these are CI only tests; its not recommended to try and get your local machine to run these tests
test.describe('Interpreter Includes/Excludes', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {

	test('Python - Can Include an Interpreter', async function ({ app, python, userSettings, logger }) {

		const hiddenPython = process.env.POSITRON_HIDDEN_PY;

		if (hiddenPython) {
			await userSettings.set([['python.interpreters.include', '["/home/runner/scratch/python-env"]']], true);
			await app.workbench.interpreter.selectInterpreter(InterpreterType.Python, hiddenPython, true);
		} else {
			logger.log('Hidden Python version not set'); // use this for now so release test can essentially skip this case
		}
	});

	test('R - Can Include an Interpreter', async function ({ app, r, userSettings, logger }) {

		const hiddenR = process.env.POSITRON_HIDDEN_R;

		if (hiddenR) {
			await userSettings.set([['positron.r.customRootFolders', '["/home/runner/scratch"]']], true);
			await app.workbench.interpreter.selectInterpreter(InterpreterType.R, hiddenR, true);
		} else {
			logger.log('Hidden R version not set'); // use this for now so release test can essentially skip this case
		}
	});
});
