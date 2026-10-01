/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Copy from Output and paste to Editor', { tag: [tags.WIN, tags.OUTPUT, tags.EDITOR] }, () => {
	test('Copy Window output log content to editor', async function ({ app, page }) {
		const { editors, layouts, output, quickaccess } = app.workbench;

		await layouts.enterLayout('fullSizedPanel');
		await output.openOutputPane('Window');
		await output.scrollToTop();
		await output.selectFirstNLines(15);
		const copiedText = await output.copySelectedText();

		// The clipboard carries CRLF on Windows and the editor renders each line as
		// its own element, so a whole-string match never lines up. Compare per line.
		const copiedLines = new Set(copiedText.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
		expect(copiedLines.size).toBeGreaterThan(0);

		await quickaccess.runCommand('workbench.action.minimizePanel');
		await editors.newUntitledFile();
		const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${modifier}+V`);

		for (const line of copiedLines) {
			await editors.expectEditorToContain(line);
		}
	});
});
