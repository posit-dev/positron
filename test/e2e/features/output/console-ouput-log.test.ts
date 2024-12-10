/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Output Log', { tag: [tags.WEB, tags.OUTPUT, tags.CONSOLE] }, () => {
	test.beforeEach(async function ({ app }) {
		await app.workbench.positronLayouts.enterLayout('stacked');
	});

	test('Python - Verify Console Output Log Contents [C667518]', async function ({ app, python }) {
		const activeConsole = app.workbench.positronConsole.activeConsole;
		await activeConsole.click();

		await app.workbench.positronConsole.typeToConsole('a = b');
		await app.workbench.positronConsole.sendEnterKey();

		await app.workbench.positronOutput.clickOutputTab();
		await app.workbench.positronLayouts.enterLayout('fullSizedPanel');
		await app.workbench.positronOutput.waitForOutContaining("name 'b' is not defined");
	});

	test('R - Verify Console Output Log Contents [C667519]', async function ({ app, r }) {
		const activeConsole = app.workbench.positronConsole.activeConsole;
		await activeConsole.click();

		await app.workbench.positronConsole.typeToConsole('a = b');
		await app.workbench.positronConsole.sendEnterKey();

		await app.workbench.positronOutput.clickOutputTab();
		await app.workbench.positronLayouts.enterLayout('fullSizedPanel');
		await app.workbench.positronOutput.waitForOutContaining("object 'b' not found");
	});
});
