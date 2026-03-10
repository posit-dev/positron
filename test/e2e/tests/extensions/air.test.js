"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Extensions', {
    tag: [_test_setup_1.tags.EXTENSIONS, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN],
}, () => {
    (0, _test_setup_1.test)('Verify AIR extension basic functionality', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, openFile, hotKeys }) {
        await openFile('workspaces/r-formatting/bad-formatting.r');
        await hotKeys.formatDocument(); // Air is default for R document formatting
        await hotKeys.minimizeBottomPanel();
        await app.workbench.editor.waitForEditorContents('bad-formatting.r', (contents) => {
            return contents.includes(formattedFile);
        });
    });
});
// note that waitForEditorContents removes line breaks
const formattedFile = 'badFunction <- function(x, y) {  if (x > y) {    print("x is greater than y")  } else {    print("x is less than or equal to y")  }  for (i in 1:10) {    print(paste("Number is", i))    if (i %% 2 == 0) {      print("Even")    } else {      print("Odd")    }  }  sum <- x + y  return(sum)}';
//# sourceMappingURL=air.test.js.map