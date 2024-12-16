/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// In order to run this test on Windows, I think we need to set the env var:
// RETICULATE_PYTHON
// to the installed python path

test.describe('Reticulate', {
	tag: [tags.WEB, tags.RETICULATE],
	annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5226' }]
}, () => {
	test.beforeAll(async function ({ app, userSettings }) {
		try {
			// remove this once https://github.com/posit-dev/positron/issues/5226
			// is resolved
			await userSettings.set([
				['positronKernelSupervisor.enable', 'false'],
				['positron.reticulate.enabled', 'true']
			]);

		} catch (e) {
			app.code.driver.takeScreenshot('reticulateSetup');
			throw e;
		}
	});

	test('R - Verify Basic Reticulate Functionality [C...]', async function ({ app, r, interpreter }) {

		await app.workbench.positronConsole.pasteCodeToConsole('reticulate::repl_python()');
		await app.workbench.positronConsole.sendEnterKey();

		try {
			await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Yes/no/cancel')));
			await app.workbench.positronConsole.typeToConsole('no');
			await app.workbench.positronConsole.sendEnterKey();
		} catch {
			// Prompt did not appear
		}

		await app.workbench.positronConsole.waitForReady('>>>');
		await app.workbench.positronConsole.pasteCodeToConsole('x=100');
		await app.workbench.positronConsole.sendEnterKey();

		await interpreter.set('R');

		await app.workbench.positronConsole.pasteCodeToConsole('y<-reticulate::py$x');
		await app.workbench.positronConsole.sendEnterKey();
		await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');

		await expect(async () => {
			const variablesMap = await app.workbench.positronVariables.getFlatVariables();
			expect(variablesMap.get('y')).toStrictEqual({ value: '100', type: 'int' });
		}).toPass({ timeout: 60000 });

	});
});
