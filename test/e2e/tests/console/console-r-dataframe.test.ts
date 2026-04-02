/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Pane: R Data Frame Output', {
	tag: [tags.CONSOLE, tags.ARK]
}, () => {

	test('R - data.frame autoprint shows correct output', async function ({ app, r }) {
		// Create and print a simple data frame
		await app.workbench.console.executeCode('R', 'df <- data.frame(x = 1:3, y = c("a", "b", "c"))');
		await app.workbench.console.executeCode('R', 'df');

		// The console should show the data frame contents
		await app.workbench.console.waitForConsoleContents('x y', { timeout: 30000 });
		await app.workbench.console.waitForConsoleContents('1 a', { timeout: 10000 });
	});
});
