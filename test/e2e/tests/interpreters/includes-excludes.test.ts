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

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'python.interpreters.exclude': ["~/.pyenv"],
			'positron.r.interpreters.exclude': ["/opt/R/4.4.2"],
		}, { reload: true });
	});

	test('R - Can Exclude an Interpreter', {
		tag: [tags.ARK]
	}, async function ({ app, sessions }) {

		const alternateR = process.env.POSITRON_R_ALT_VER_SEL;

		if (!alternateR) {
			return fail('Alternate R version not set');
		}

		const failMessage = 'selectInterpreter was supposed to fail as /opt/R/4.4.2 was excluded';
		try {
			await sessions.start('rAlt', { reuse: false });
			fail(failMessage);
		} catch (e) {
			if (e instanceof Error && e.message.includes(failMessage)) {
				fail(failMessage);
			}
			// Success = interpreter was correctly excluded
		}

		await app.code.driver.page.keyboard.press('Escape');
	});

	test('Python - Can Exclude an Interpreter', async function ({ app, settings, sessions }) {

		const alternatePython = process.env.POSITRON_PY_ALT_VER_SEL;

		if (!alternatePython) {
			return fail('Alternate Python version not set');
		}

		const failMessage = 'selectInterpreter was supposed to fail as /root/.pyenv was excluded';
		await settings.set({
			'python.interpreters.exclude': ["/root/.pyenv"]
		}, { reload: true, waitMs: 5000 });

		try {
			await sessions.start('pythonAlt', { reuse: false });
			fail(failMessage);
		} catch (e) {
			if (e instanceof Error && e.message.includes(failMessage)) {
				fail(failMessage);
			}
			// Success = interpreter was correctly excluded
		}

		await app.code.driver.page.keyboard.press('Escape');
	});

});

test.describe('Interpreter: Override', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {

	test.beforeAll(async function ({ settings }) {
		const pythonPath = '/root/scratch/python-env';

		await settings.set({
			'python.interpreters.override': [pythonPath],
			'positron.r.interpreters.override': ["/opt/R/4.4.2/bin/R"]
		}, { reload: true });
	});

	test('R - Can Override Interpreter Discovery', {
		tag: [tags.ARK]
	}, async function ({ app, sessions }) {

		const alternateR = process.env.POSITRON_R_ALT_VER_SEL;

		if (!alternateR) {
			return fail('Alternate R version not set');
		}

		const failMessage = 'selectInterpreter was supposed to fail as /opt/R/4.4.2 was overriden';
		try {
			await sessions.start('r', { reuse: false });
			fail(failMessage);
		} catch (e) {
			if (e instanceof Error && e.message.includes(failMessage)) {
				fail(failMessage);
			}
			// Success = interpreter was correctly overriden
		}
		await app.code.driver.page.keyboard.press('Escape');
	});

	test('Python - Can Override Interpreter Discovery', async function ({ app, sessions }) {

		const alternatePython = process.env.POSITRON_PY_ALT_VER_SEL;

		if (!alternatePython) {
			return fail('Alternate Python version not set');
		}

		const failMessage = 'selectInterpreter was supposed to fail as ~/.pyenv was overriden';
		try {
			await sessions.start('python', { reuse: false });
			fail(failMessage);
		} catch (e) {
			if (e instanceof Error && e.message.includes(failMessage)) {
				fail(failMessage);
			}
			// Success = interpreter was correctly overriden
		}

		await app.code.driver.page.keyboard.press('Escape');
	});

});
