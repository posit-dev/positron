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
		// Undo the formatting before closing. files.autoSave writes whatever the buffer holds
		// in the web lanes, and a save still in flight when the editor closes lands after the
		// restore below -- undoing first means a late write writes the baseline text anyway.
		await app.workbench.editors.selectTab('bad-formatting.r');
		await hotKeys.undo();
		await app.workbench.editor.waitForEditorContents('bad-formatting.r', (contents: string) => {
			return !contents.includes(formattedFile);
		});

		await hotKeys.closeAllEditors();
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
