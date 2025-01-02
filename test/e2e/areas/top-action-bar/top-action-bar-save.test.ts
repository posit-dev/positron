/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Top Action Bar - Save Actions', {
	tag: [tags.WEB, tags.TOP_ACTION_BAR]
}, () => {

	test.beforeAll(async function ({ app, userSettings }) {
		if (app.web) {
			await userSettings.set([['files.autoSave', 'false']]);
		}
	});

	test('Save and Save All both disabled when no unsaved editors are open [C656253]', async function ({ app }) {
		await app.workbench.positronQuickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
		await expect(async () => {
			expect(await app.workbench.positronTopActionBar.saveButton.isDisabled()).toBeTruthy();
			expect(await app.workbench.positronTopActionBar.saveAllButton.isDisabled()).toBeTruthy();
		}).toPass({ timeout: 20000 });
	});

	test('Save enabled and Save All disabled when a single unsaved file is open [C656254]', async function ({ app }) {
		const fileName = 'README.md';
		await app.workbench.positronQuickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
		await app.workbench.positronQuickaccess.openFile(join(app.workspacePathOrFolder, fileName));
		await app.workbench.positronQuickaccess.runCommand('workbench.action.keepEditor', { keepOpen: false });
		await app.workbench.positronEditors.selectTab(fileName);
		await app.workbench.positronEditor.waitForTypeInEditor(fileName, 'Puppies frolicking in a meadow of wildflowers');
		// The file is now "dirty" and the save buttons should be enabled
		await app.workbench.positronEditors.waitForTab(fileName, true);
		await expect(async () => {
			expect(await app.workbench.positronTopActionBar.saveButton.isEnabled()).toBeTruthy();
			expect(await app.workbench.positronTopActionBar.saveAllButton.isEnabled()).toBeTruthy();
		}).toPass({ timeout: 10000 });
		await app.workbench.positronTopActionBar.saveButton.click();
		// The file is now saved, so the file should no longer be "dirty"
		await app.workbench.positronEditors.waitForTab(fileName, false);
		await expect(async () => {
			// The Save button stays enabled even when the active file is not "dirty"
			expect(await app.workbench.positronTopActionBar.saveButton.isEnabled()).toBeTruthy();
			// The Save All button is disabled when less than 2 files are "dirty"
			expect(await app.workbench.positronTopActionBar.saveAllButton.isDisabled()).toBeTruthy();
		}).toPass({ timeout: 10000 });
	});

	test('Save and Save All both enabled when multiple unsaved files are open [C656255]', async function ({ app }) {
		const fileName1 = 'README.md';
		const fileName2 = 'DESCRIPTION';
		const text = 'Kittens playing with yarn';
		// Open two files and type in some text
		await app.workbench.positronQuickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
		await app.workbench.positronQuickaccess.openFile(join(app.workspacePathOrFolder, fileName1));
		await app.workbench.positronQuickaccess.runCommand('workbench.action.keepEditor', { keepOpen: false });
		await app.workbench.positronQuickaccess.openFile(join(app.workspacePathOrFolder, fileName2));
		await app.workbench.positronQuickaccess.runCommand('workbench.action.keepEditor', { keepOpen: false });
		await app.workbench.positronEditors.selectTab(fileName1);
		await app.workbench.positronEditor.waitForTypeInEditor(fileName1, text);
		await app.workbench.positronEditors.selectTab(fileName2);
		await app.workbench.positronEditor.waitForTypeInEditor(fileName2, text);
		// The files are now "dirty" and the save buttons should be enabled
		await app.workbench.positronEditors.waitForTab(fileName1, true);
		await app.workbench.positronEditors.waitForTab(fileName2, true);
		await expect(async () => {
			expect(await app.workbench.positronTopActionBar.saveButton.isEnabled()).toBeTruthy();
			expect(await app.workbench.positronTopActionBar.saveAllButton.isEnabled()).toBeTruthy();
		}).toPass({ timeout: 10000 });
		await app.workbench.positronTopActionBar.saveAllButton.click();
		// The files are now saved, so the files should no longer be "dirty"
		await app.workbench.positronEditors.waitForTab(fileName1, false);
		await app.workbench.positronEditors.waitForTab(fileName2, false);
		await expect(async () => {
			// The Save button stays enabled even when the active file is not "dirty"
			expect(await app.workbench.positronTopActionBar.saveButton.isEnabled()).toBeTruthy();
			// The Save All button is disabled when less than 2 files are "dirty"
			expect(await app.workbench.positronTopActionBar.saveAllButton.isDisabled()).toBeTruthy();
		}).toPass({ timeout: 10000 });
	});

	test('Save and Save All both enabled when an unsaved new file is open [C656256]', async function ({ app }) {
		const fileName = 'Untitled-1';
		const text = 'Bunnies hopping through a field of clover';
		// Open a new file and type in some text
		await app.workbench.positronQuickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
		await app.workbench.positronQuickaccess.runCommand('workbench.action.files.newUntitledFile', { keepOpen: false });
		await app.workbench.positronEditors.selectTab(fileName);
		await app.workbench.positronEditor.waitForTypeInEditor(fileName, text);
		// The file is now "dirty" and the save buttons should be enabled
		await app.workbench.positronEditors.waitForTab(fileName, true);
		await expect(async () => {
			expect(await app.workbench.positronTopActionBar.saveButton.isEnabled()).toBeTruthy();
			expect(await app.workbench.positronTopActionBar.saveAllButton.isEnabled()).toBeTruthy();
		}).toPass({ timeout: 10000 });
		// We won't try to click the Save buttons because a system dialog will pop up and we
		// can't automate interactions with the native file dialog
	});
});

