/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { expect } from '@playwright/test';
import { Application, Logger } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 * Top Action Bar test cases
 */
export function setup(logger: Logger) {
	describe('Top Action Bar', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Save Actions', () => {
			before(async function () {

			});

			it('Save and Save All both disabled when no unsaved editors are open [C656253] #nightly', async function () {
				const app = this.app as Application;
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
				expect(await app.workbench.positronTopActionBar.saveButton.isDisabled()).toBeTruthy();
				expect(await app.workbench.positronTopActionBar.saveAllButton.isDisabled()).toBeTruthy();
			});

			it('Save enabled and Save All disabled when a single unsaved file is open [C656254] #nightly', async function () {
				const app = this.app as Application;
				const fileName = 'README.md';
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, fileName));
				await app.workbench.quickaccess.runCommand('workbench.action.keepEditor', { keepOpen: false });
				await app.workbench.editors.selectTab(fileName);
				await app.workbench.editor.waitForTypeInEditor(fileName, 'Puppies frolicking in a meadow of wildflowers');
				// The file is now "dirty" and the save buttons should be enabled
				await app.workbench.editors.waitForTab(fileName, true);
				await expect(async () => {
					expect(await app.workbench.positronTopActionBar.saveButton.isEnabled()).toBeTruthy();
					expect(await app.workbench.positronTopActionBar.saveAllButton.isEnabled()).toBeTruthy();
				}).toPass({ timeout: 10000 });
				await app.workbench.positronTopActionBar.saveButton.click();
				// The file is now saved, so the file should no longer be "dirty"
				await app.workbench.editors.waitForTab(fileName, false);
				await expect(async () => {
					// The Save button stays enabled even when the active file is not "dirty"
					expect(await app.workbench.positronTopActionBar.saveButton.isEnabled()).toBeTruthy();
					// The Save All button is disabled when less than 2 files are "dirty"
					expect(await app.workbench.positronTopActionBar.saveAllButton.isDisabled()).toBeTruthy();
				}).toPass({ timeout: 10000 });
			});

			it('Save and Save All both enabled when multiple unsaved files are open [C656255] #nightly', async function () {
				const app = this.app as Application;
				const fileName1 = 'README.md';
				const fileName2 = 'DESCRIPTION';
				const text = 'Kittens playing with yarn';
				// Open two files and type in some text
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, fileName1));
				await app.workbench.quickaccess.runCommand('workbench.action.keepEditor', { keepOpen: false });
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, fileName2));
				await app.workbench.quickaccess.runCommand('workbench.action.keepEditor', { keepOpen: false });
				await app.workbench.editors.selectTab(fileName1);
				await app.workbench.editor.waitForTypeInEditor(fileName1, text);
				await app.workbench.editors.selectTab(fileName2);
				await app.workbench.editor.waitForTypeInEditor(fileName2, text);
				// The files are now "dirty" and the save buttons should be enabled
				await app.workbench.editors.waitForTab(fileName1, true);
				await app.workbench.editors.waitForTab(fileName2, true);
				await expect(async () => {
					expect(await app.workbench.positronTopActionBar.saveButton.isEnabled()).toBeTruthy();
					expect(await app.workbench.positronTopActionBar.saveAllButton.isEnabled()).toBeTruthy();
				}).toPass({ timeout: 10000 });
				await app.workbench.positronTopActionBar.saveAllButton.click();
				// The files are now saved, so the files should no longer be "dirty"
				await app.workbench.editors.waitForTab(fileName1, false);
				await app.workbench.editors.waitForTab(fileName2, false);
				await expect(async () => {
					// The Save button stays enabled even when the active file is not "dirty"
					expect(await app.workbench.positronTopActionBar.saveButton.isEnabled()).toBeTruthy();
					// The Save All button is disabled when less than 2 files are "dirty"
					expect(await app.workbench.positronTopActionBar.saveAllButton.isDisabled()).toBeTruthy();
				}).toPass({ timeout: 10000 });
			});

			it('Save and Save All both enabled when an unsaved new file is open [C656256] #nightly', async function () {
				const app = this.app as Application;
				const fileName = 'Untitled-1';
				const text = 'Bunnies hopping through a field of clover';
				// Open a new file and type in some text
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
				await app.workbench.quickaccess.runCommand('workbench.action.files.newUntitledFile', { keepOpen: false });
				await app.workbench.editors.selectTab(fileName);
				await app.workbench.editor.waitForTypeInEditor(fileName, text);
				// The file is now "dirty" and the save buttons should be enabled
				await app.workbench.editors.waitForTab(fileName, true);
				await expect(async () => {
					expect(await app.workbench.positronTopActionBar.saveButton.isEnabled()).toBeTruthy();
					expect(await app.workbench.positronTopActionBar.saveAllButton.isEnabled()).toBeTruthy();
				}).toPass({ timeout: 10000 });
				// We won't try to click the Save buttons because a system dialog will pop up and we
				// can't automate interactions with the native file dialog
			});
		});

	});

}

