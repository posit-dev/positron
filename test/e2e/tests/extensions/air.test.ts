/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});


test.describe('Extensions', {
	tag: [tags.EXTENSIONS, tags.WEB, tags.WIN],
}, () => {

	test('Verify AIR extension basic functionality', {
		tag: [tags.EXTENSIONS, tags.WEB, tags.WIN]
	}, async function ({ app, openFile, runCommand }) {

		await openFile('workspaces/r-formatting/bad-formatting.r');

		// hotKeys approach fails on Ubuntu as key combination is
		// overriden by Positron
		await runCommand('command:editor.action.formatDocument', { keepOpen: true });
		await app.workbench.quickInput.waitForQuickInputOpened();
		await app.workbench.quickInput.selectQuickInputElementContaining('Air');
		await app.workbench.quickInput.waitForQuickInputClosed();

		await app.workbench.editor.waitForEditorContents('bad-formatting.r', (contents: string) => {
			return contents.includes(formattedFile);
		});

	});
});

// note that waitForEditorContents removes line breaks
const formattedFile = 'badFunction <- function(x, y) {  if (x > y) {    print("x is greater than y")  } else {    print("x is less than or equal to y")  }  for (i in 1:10) {    print(paste("Number is", i))    if (i %% 2 == 0) {      print("Even")    } else {      print("Odd")    }  }  sum <- x + y  return(sum)}';
