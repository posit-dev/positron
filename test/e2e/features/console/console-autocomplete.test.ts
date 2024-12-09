/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { fail } from 'assert';

test.use({
	suiteId: __filename
});

test.describe('Console Autocomplete', {
	tag: ['@web', '@win', '@console']
}, () => {
	test('Python - Verify Console Autocomplete [C947968]', async function ({ app, python }) {
		await app.workbench.positronConsole.pasteCodeToConsole('import pandas as pd');
		await app.workbench.positronConsole.sendEnterKey();
		await app.workbench.positronConsole.typeToConsole('df = pd.Dat');

		const suggestionList = await app.workbench.positronConsole.getSuggestions();
		if (suggestionList.length < 3) {
			fail('Less than 3 suggestions found');
		}
	});

	test('R - Verify Console Autocomplete [C947969]', async function ({ app, r }) {
		await app.workbench.positronConsole.pasteCodeToConsole('library(arrow)');
		await app.workbench.positronConsole.sendEnterKey();

		// need to type to console slowly to see suggestions with R
		await app.workbench.positronConsole.typeToConsole('df2 <- read_p', 250);

		const suggestionList = await app.workbench.positronConsole.getSuggestions();
		if (suggestionList.length < 3) {
			fail('Less than 3 suggestions found');
		}
	});
});
