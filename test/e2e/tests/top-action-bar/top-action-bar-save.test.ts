/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Top Action Bar - Save All', {
	tag: [tags.WEB, tags.TOP_ACTION_BAR]
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		if (app.web) {
			await settings.set({ 'files.autoSave': false });
		}
	});

	test.afterAll(async function ({ cleanup }) {
		await cleanup.discardAllChanges();
	});

	test('Verify `Save All` is disabled when no unsaved editors are open', async function ({ app }) {
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
		await expect(app.workbench.topActionBar.saveAllButton).not.toBeEnabled();
	});

	test('Verify `Save All` is enabled when a single unsaved file is open and disabled after saving', async function ({ app }) {
		const fileName = 'README.md';
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, fileName));
		await app.workbench.quickaccess.runCommand('workbench.action.keepEditor', { keepOpen: false });
		await app.workbench.editor.selectTabAndType(fileName, 'Puppies frolicking in a meadow of wildflowers');

		// The file is now dirty and Save All should be enabled
		await expect(app.workbench.topActionBar.saveAllButton).toBeEnabled();
		await app.workbench.topActionBar.saveAllButton.click();

		// The file is now saved, so it should no longer be dirty
		await app.workbench.editors.waitForTab(fileName, false);

		// Save All is disabled when no files are dirty
		await expect(app.workbench.topActionBar.saveAllButton).not.toBeEnabled();
	});

	test('Verify `Save All` is enabled when multiple unsaved files are open and saves them all on click', async function ({ app }) {
		const fileName1 = 'README.md';
		const fileName2 = 'DESCRIPTION';
		const text = 'Kittens playing with yarn';

		// Open two files and type in some text
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, fileName1));
		await app.workbench.quickaccess.runCommand('workbench.action.keepEditor', { keepOpen: false });
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, fileName2));
		await app.workbench.quickaccess.runCommand('workbench.action.keepEditor', { keepOpen: false });
		await app.workbench.editor.selectTabAndType(fileName1, text);
		await app.workbench.editor.selectTabAndType(fileName2, text);

		// The files are now dirty and Save All should be enabled
		await expect(app.workbench.topActionBar.saveAllButton).toBeEnabled();
		await app.workbench.topActionBar.saveAllButton.click();

		// The files are now saved, so they should no longer be dirty
		await app.workbench.editors.waitForTab(fileName1, false);
		await app.workbench.editors.waitForTab(fileName2, false);

		// Save All is disabled when no files are dirty
		await expect(app.workbench.topActionBar.saveAllButton).not.toBeEnabled();
	});

	test('Verify `Save All` is enabled when an unsaved new file is open alongside another dirty file', async function ({ app }) {
		const fileName1 = 'README.md';
		const fileName2 = 'Untitled-1';
		const text = 'Bunnies hopping through a field of clover';

		// Open a real file, dirty it, then open an untitled file and dirty it.
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, fileName1));
		await app.workbench.quickaccess.runCommand('workbench.action.keepEditor', { keepOpen: false });
		await app.workbench.editor.selectTabAndType(fileName1, text);

		await app.workbench.quickaccess.runCommand('workbench.action.files.newUntitledFile', { keepOpen: false });
		await app.workbench.editor.selectTabAndType(fileName2, text);

		// Both files are dirty, so Save All should be enabled.
		// We don't click it because the untitled file would trigger a native
		// save dialog we can't automate.
		await expect(app.workbench.topActionBar.saveAllButton).toBeEnabled();
	});
});
