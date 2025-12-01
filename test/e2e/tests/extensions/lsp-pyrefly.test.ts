/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Suite: Positron LSP: Pyrefly Integration (Untitled Files)
// CI safety notes:
// - Creates unsaved scratch buffers only; no workspace file I/O (for now)
// - Avoids workspace-wide indexing; relies on minimal interactions

import { test, expect, tags } from '../_test.setup';

test.use({ suiteId: __filename });

test.describe('Positron LSP: Pyrefly Integration (Untitled)', { tag: [tags.WEB, tags.WIN, tags.EXTENSIONS, tags.EDITOR] }, () => {

  test('Basic Completion Suggestion', async function ({ app, runCommand }) {
    await runCommand('python.createNewFile');
    await app.workbench.editors.waitForEditorFocus('Untitled-1');
    await app.workbench.clipboard.setClipboardText('import math\nm');
    await app.workbench.clipboard.paste();
    await app.workbench.editors.expectEditorToContain('import math');
    await app.code.driver.page.keyboard.press('Control+Space');
    await expect(app.code.driver.page.locator('.suggest-widget')).toBeVisible();
  });

});
