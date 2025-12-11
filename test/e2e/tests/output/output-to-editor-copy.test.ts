/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { wait } from '../../infra/playwrightDriver.js';

test.use({
	suiteId: __filename
});

test.describe('Output to Editor Copy', { tag: [tags.WIN, tags.OUTPUT, tags.EDITOR] }, () => {
	test('Copy Window output content to editor', async function ({ app, page }) {
		const { editors, layouts, output, quickaccess } = app.workbench;

		// Step 1: Maximize the panel so it's easier to copy text
		await layouts.enterLayout('fullSizedPanel');

		// Step 2: Open the Window output
		await output.openOutputPane('Window');

		// Step 3: Scroll to the top of the Window output pane and select the first 15 lines
		wait(500); // wait for output to render
		await output.scrollToTop();
		await output.selectFirstNLines(15);

		// Step 4: Cmd/Ctrl + C to copy
		const copiedText = await output.copySelectedText();

		// Step 5: Minimize the panel so that the editor space is maximized
		await quickaccess.runCommand('workbench.action.minimizePanel');

		// Step 6: Open a new untitled file in the editor
		await editors.newUntitledFile();

		// Step 7: Paste the text into the editor
		const isMac = process.platform === 'darwin';
		const modifier = isMac ? 'Meta' : 'Control';
		await page.keyboard.press(`${modifier}+V`);

		// Step 8: Check if the editor contains the copied text
		await editors.expectEditorToContain(copiedText);
	});
});
