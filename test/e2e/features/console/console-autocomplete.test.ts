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
	test('Python - Verify Console Autocomplete [C947968]', async function ({ app, python }) {
		await app.workbench.positronConsole.pasteCodeToConsole('import pandas as pd');
		await app.workbench.positronConsole.sendEnterKey();

		await app.workbench.positronConsole.typeToConsole('df = pd.Dat');
		expect(await app.workbench.positronConsole.suggestionList.count()).toBeGreaterThan(3);
	});

	test('R - Verify Console Autocomplete [C947969]', async function ({ app, r }) {
		await app.workbench.positronConsole.pasteCodeToConsole('library(arrow)');
		await app.workbench.positronConsole.sendEnterKey();

		// need to type to console slowly to see suggestions with R
		await app.workbench.positronConsole.typeToConsole('df2 <- read_p', 250);
		expect(await app.workbench.positronConsole.suggestionList.count()).toBeGreaterThan(3);
	});
});
