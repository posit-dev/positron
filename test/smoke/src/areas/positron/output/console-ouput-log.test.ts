/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Output Log', { tag: ['@web'] }, () => {
	test.beforeEach(async function ({ app }) {
		await app.workbench.positronLayouts.enterLayout('stacked');
	});

	test('Python - Verify Console Output Log Contents [C667518]', async function ({ app, python }) {
		const activeConsole = app.workbench.positronConsole.activeConsole;
		await activeConsole.click();

		await app.workbench.positronConsole.typeToConsole('a = b');
		await app.workbench.positronConsole.sendEnterKey();

		// retry in case the console output log is slow to appear
		await expect(async () => {
			await app.workbench.positronOutput.openOutputPane(process.env.POSITRON_PY_VER_SEL!);
			await app.workbench.positronLayouts.enterLayout('fullSizedPanel');
			await app.workbench.positronOutput.waitForOutContaining("name 'b' is not defined");
		}).toPass({ timeout: 60000 });
	});

	test('R - Verify Console Output Log Contents [C667519]', async function ({ app, r }) {
		const activeConsole = app.workbench.positronConsole.activeConsole;
		await activeConsole.click();

		await app.workbench.positronConsole.typeToConsole('a = b');
		await app.workbench.positronConsole.sendEnterKey();

		// retry in case the console output log is slow to appear
		await expect(async () => {
			await app.workbench.positronOutput.openOutputPane(process.env.POSITRON_R_VER_SEL!);
			await app.workbench.positronLayouts.enterLayout('fullSizedPanel');
			await app.workbench.positronOutput.waitForOutContaining("object 'b' not found");
		}).toPass({ timeout: 60000 });
	});
});
