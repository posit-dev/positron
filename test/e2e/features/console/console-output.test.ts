/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Output', { tag: ['@win', '@console'] }, () => {
	test('R - Console output in a loop with short pauses [C885225]', async function ({ app, r }) {
		await app.workbench.positronConsole.pasteCodeToConsole(rCode);
		await app.workbench.positronConsole.sendEnterKey();
		await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Why do programmers prefer dark mode')));
		await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Because light attracts bugs!')));
	});
});

const rCode = `tokens <- c(
	"",
	"Why",
	" do",
	" programmers",
	" prefer",
	" dark",
	" mode",
	"?\n\n",
	"Because",
	" light",
	" attracts",
	" bugs",
	"!"
	)

	for(token in tokens) {
		cat(token)
		Sys.sleep(0.01)
	}`;
