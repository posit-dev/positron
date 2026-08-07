/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});


test.describe('Extensions', {
	tag: [tags.EXTENSIONS, tags.WEB, tags.WIN],
}, () => {

	test.afterEach(async function ({ app, hotKeys, cleanup }) {
		// Close first: the buffer holds the formatted text, and files.autoSave would write it
		// back over the restore in the web lanes. Wait for the tab to go before restoring --
		// the close flushes that pending write, and it lands after the restore otherwise.
		await hotKeys.closeAllEditors();
		await app.workbench.editors.verifyTab('bad-formatting.r', { isVisible: false, isSelected: false });
		// Formatted in place. Never saved, but autoSave lands the edit on disk in the web lanes.
		await cleanup.restoreFiles([join('workspaces', 'r-formatting', 'bad-formatting.r')]);
	});

	test('Verify AIR extension basic functionality', {
		tag: [tags.ARK]
	}, async function ({ app, openFile, hotKeys }) {

		await openFile('workspaces/r-formatting/bad-formatting.r');
		await hotKeys.formatDocument(); // Air is default for R document formatting

		await hotKeys.minimizeBottomPanel();

		await app.workbench.editor.waitForEditorContents('bad-formatting.r', (contents: string) => {
			return contents.includes(formattedFile);
		});

	});

});

// note that waitForEditorContents removes line breaks
const formattedFile = 'badFunction <- function(x, y) {  if (x > y) {    print("x is greater than y")  } else {    print("x is less than or equal to y")  }  for (i in 1:10) {    print(paste("Number is", i))    if (i %% 2 == 0) {      print("Even")    } else {      print("Odd")    }  }  sum <- x + y  return(sum)}';
