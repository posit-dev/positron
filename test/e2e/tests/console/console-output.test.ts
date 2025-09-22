/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Output', { tag: [tags.WIN, tags.CONSOLE, tags.WEB] }, () => {
	test('R - Ensure output to console in a loop with short pauses', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		await app.positron.console.pasteCodeToConsole(rCode);
		await app.positron.console.sendEnterKey();
		await app.positron.console.waitForConsoleContents('Why do programmers prefer dark mode');
		await app.positron.console.waitForConsoleContents('Because light attracts bugs!');
	});

	test('Python - Ensure long console output wraps appropriately', async function ({ app, python }) {
		await app.positron.console.waitForReady('>>>');
		await app.positron.console.pasteCodeToConsole(pyCode);
		await app.positron.console.sendEnterKey();
		await app.positron.console.waitForReady('>>>');

		const el = app.positron.console.activeConsole;
		expect(await el.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(await el.evaluate((el) => el.clientWidth));
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

const pyCode = `"Blah" * 300`;
