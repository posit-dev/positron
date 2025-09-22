/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Output Log', { tag: [tags.WEB, tags.WIN, tags.OUTPUT, tags.CONSOLE] }, () => {
	test.beforeEach(async function ({ app }) {
		await app.positron.layouts.enterLayout('stacked');
	});

	test('Python - Verify Console Output Log Contents', async function ({ app, python }) {
		const activeConsole = app.positron.console.activeConsole;
		await activeConsole.click();

		await app.positron.console.typeToConsole('a = b');
		await app.positron.console.sendEnterKey();

		await app.positron.output.clickOutputTab();
		await app.positron.layouts.enterLayout('fullSizedPanel');
		await app.positron.output.waitForOutContaining("name 'b' is not defined");
	});

	test('R - Verify Console Output Log Contents', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		const activeConsole = app.positron.console.activeConsole;
		await activeConsole.click();

		await app.positron.console.typeToConsole('a = b');
		await app.positron.console.sendEnterKey();

		await app.positron.output.clickOutputTab();
		await app.positron.layouts.enterLayout('fullSizedPanel');
		await app.positron.output.waitForOutContaining("object 'b' not found");
	});
});
