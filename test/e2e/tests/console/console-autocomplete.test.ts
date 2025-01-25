/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Autocomplete', {
	tag: [tags.WEB, tags.WIN, tags.CONSOLE]
}, () => {
	test('Python - Verify Console Autocomplete', async function ({ app, python }) {
		await app.workbench.console.pasteCodeToConsole('import pandas as pd');
		await app.workbench.console.sendEnterKey();

		await app.workbench.console.typeToConsole('df = pd.Dat');
		await expect(app.workbench.console.suggestionList).toHaveCount(8, { timeout: 15000 });
	});

	test('R - Verify Console Autocomplete', async function ({ app, r }) {
		await app.workbench.console.pasteCodeToConsole('library(arrow)');
		await app.workbench.console.sendEnterKey();

		// need to type to console slowly to see suggestions with R
		await app.workbench.console.typeToConsole('df2 <- read_p', 250);
		await expect(app.workbench.console.suggestionList).toHaveCount(4, { timeout: 15000 });
	});
});
