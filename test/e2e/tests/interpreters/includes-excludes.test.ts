/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// these are CI only tests; its not recommended to try and get your local machine to run these tests
test.describe('Interpreter: Includes', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['python.interpreters.include', '["/home/runner/scratch/python-env"]']], true);
		await userSettings.set([['positron.r.customRootFolders', '["/home/runner/scratch"]']], true);
	});

	test('Python - Can Include an Interpreter', {
		tag: [tags.NIGHTLY_ONLY]
	}, async function ({ sessions }) {

		const hiddenPython = process.env.POSITRON_HIDDEN_PY;

		hiddenPython
			? await sessions.start('pythonHidden')
			: fail('Hidden Python version not set');
	});

	test('R - Can Include an Interpreter', {
		tag: [tags.NIGHTLY_ONLY]
	}, async function ({ sessions }) {

		const hiddenR = process.env.POSITRON_HIDDEN_R;

		hiddenR
			? await sessions.start('rHidden')
			: fail('Hidden R version not set');
	});
});

test.describe('Interpreter: Excludes', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['python.interpreters.exclude', '["~/.pyenv"]']], true);
		await userSettings.set([['positron.r.interpreters.exclude', '["/opt/R/4.4.2"]']], true);
	});

	test('R - Can Exclude an Interpreter', async function ({ app, sessions }) {

		const alternateR = process.env.POSITRON_R_ALT_VER_SEL;

		if (!alternateR) {
			return fail('Alternate R version not set');
		}

		try {
			await sessions.start('rAlt', { reuse: false });
			fail('selectInterpreter was supposed to fail as /opt/R/4.4.2 was excluded');
		} catch (e) {
			// Success = interpreter was correctly excluded
		}

		await app.code.driver.page.keyboard.press('Escape');
	});

	test('Python - Can Exclude an Interpreter', async function ({ app, userSettings, sessions }) {

		const alternatePython = process.env.POSITRON_PY_ALT_VER_SEL;

		if (!alternatePython) {
			return fail('Alternate Python version not set');
		}

		const failMessage = 'selectInterpreter was supposed to fail as ~/.pyenv was excluded';
		await userSettings.set([['python.interpreters.exclude', '["~/.pyenv"]']], true);

		try {
			await sessions.start('pythonAlt', { reuse: false });
			fail(failMessage);
		} catch {
			// Success = interpreter was correctly excluded
		}

		await app.code.driver.page.keyboard.press('Escape');
	});

});

test.describe('Interpreter: Override', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['python.interpreters.override', '["/home/runner/scratch/python-env"]']], true);
		await userSettings.set([['r.interpreters.override', '["/opt/R/4.4.2"]']], true);
	});

	test('R - Can Override Interpreter Discovery', async function ({ app, sessions }) {

		const alternateR = process.env.POSITRON_R_ALT_VER_SEL;

		if (!alternateR) {
			return fail('Alternate R version not set');
		}

		try {
			await sessions.start('r', { reuse: false });
			fail('selectInterpreter was supposed to fail as default R was overridden');
		} catch (e) {
			// Success = interpreter was correctly overriden
		}
		await app.code.driver.page.keyboard.press('Escape');
		await sessions.start('rAlt', { reuse: false });
	});

	test('Python - Can Override Intgerpreter Discovery', async function ({ app, userSettings, sessions }) {

		const alternatePython = process.env.POSITRON_PY_ALT_VER_SEL;

		if (!alternatePython) {
			return fail('Alternate Python version not set');
		}

		await userSettings.set([['python.interpreters.exclude', '["~/.pyenv"]']], true);

		try {
			await sessions.start('python', { reuse: false });
			fail('selectInterpreter was supposed to fail as ~/.pyenv was overriden');
		} catch {
			// Success = interpreter was correctly overriden
		}

		await app.code.driver.page.keyboard.press('Escape');
		await sessions.start('pythonAlt', { reuse: false });
	});

});
