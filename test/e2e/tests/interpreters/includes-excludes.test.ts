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

// these are CI only tests; its not recommended to try and get your local machine to run these tests
test.describe.fixme('Interpreter Includes/Excludes', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {

	test('Python - Can Include an Interpreter', {
		tag: [tags.NIGHTLY_ONLY]
	}, async function ({ app, python, userSettings }) {

		const hiddenPython = process.env.POSITRON_HIDDEN_PY;

		if (hiddenPython) {
			await userSettings.set([['python.interpreters.include', '["/home/runner/scratch/python-env"]']], true);
			await app.workbench.interpreter.selectInterpreter(InterpreterType.Python, hiddenPython, true);
		} else {
			fail('Hidden Python version not set');
		}
	});

	test('R - Can Include an Interpreter', {
		tag: [tags.NIGHTLY_ONLY]
	}, async function ({ app, r, userSettings, logger }) {

		const hiddenR = process.env.POSITRON_HIDDEN_R;

		if (hiddenR) {
			await userSettings.set([['positron.r.customRootFolders', '["/home/runner/scratch"]']], true);
			await app.workbench.interpreter.selectInterpreter(InterpreterType.R, hiddenR, true);
		} else {
			fail('Hidden R version not set');
		}
	});

	test('R - Can Exclude an Interpreter', async function ({ app, r, userSettings }) {

		const alternateR = process.env.POSITRON_R_ALT_VER_SEL;

		if (alternateR) {
			await app.workbench.interpreter.selectInterpreter(InterpreterType.R, alternateR, true);

			const failMessage = 'selectInterpreter was supposed to fail as /opt/R/4.4.2 was excluded';
			await userSettings.set([['positron.r.interpreters.exclude', '["/opt/R/4.4.2"]']], true);
			try {
				await app.workbench.interpreter.selectInterpreter(InterpreterType.R, alternateR, true);
				fail(failMessage);
			} catch (e) {
				if (e instanceof Error && e.message.includes(failMessage)) {
					fail(failMessage);
				}
			}

			await app.code.driver.page.keyboard.press('Escape');
		} else {
			fail('Alternate R version not set');
		}
	});

	test('Python - Can Exclude an Interpreter', async function ({ app, python, userSettings, logger }) {

		const alternatePython = process.env.POSITRON_PY_ALT_VER_SEL;

		if (alternatePython) {
			await app.workbench.interpreter.selectInterpreter(InterpreterType.Python, alternatePython, true);

			const failMessage = 'selectInterpreter was supposed to fail as ~/.pyenv was excluded';
			await userSettings.set([['python.interpreters.exclude', '["~/.pyenv"]']], true);
			try {
				await app.workbench.interpreter.selectInterpreter(InterpreterType.Python, alternatePython, true);
				fail(failMessage);
			} catch (e) {
				if (e instanceof Error && e.message.includes(failMessage)) {
					fail(failMessage);
				}
			}

			await app.code.driver.page.keyboard.press('Escape');
		} else {
			fail('Alternate Python version not set');
		}
	});

});
