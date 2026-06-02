/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, Locator, Page } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

async function openExplorerContextMenu(page: Page, row: Locator): Promise<Locator> {
	await row.click();
	await row.dispatchEvent('contextmenu');
	const menu = page.locator('.monaco-menu');
	await expect(menu).toBeVisible({ timeout: 5000 });
	return menu;
}

// The positron-file-transfer extension subscribes to positron.window.onDidUploadFile
// and positron.window.onDidDownloadFile and shows a notification when each fires.
// We use those notifications as a visible signal that the underlying API events fired.
// Upload and Download are only wired up in web context, so these tests run on chromium.
test.describe('File Transfer API', {
	tag: [tags.EXTENSIONS, tags.WEB_ONLY]
}, () => {

	test.beforeEach(async function ({ app }) {
		// Pre-grant clipboard permissions so chromium doesn't pop a permission
		// dialog mid-test (it steals focus and swallows right-clicks).
		try {
			await app.code.driver.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
		} catch {
			// Non-chromium browsers don't support this API.
		}

		// Make sure the Explorer view is open so its context menu items are reachable.
		const page = app.code.driver.currentPage;
		const explorerView = page.locator('.explorer-folders-view');
		if (!(await explorerView.isVisible())) {
			const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
			await page.keyboard.press(`${modifier}+Shift+E`);
		}
		await expect(explorerView).toBeVisible({ timeout: 10000 });

		// Collapse any expanded folders so tests start from a known layout
		// (otherwise a previous test could leave duplicate file names visible).
		await app.workbench.quickaccess.runCommand('workbench.files.action.collapseExplorerFolders');
	});

	test('Uploading a file fires onDidUploadFile', async function ({ app, cleanup }) {
		const page = app.code.driver.currentPage;
		const { toasts } = app.workbench;

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-upload-'));
		const fileName = `upload-${Date.now()}.txt`;
		const tempFilePath = path.join(tempDir, fileName);
		fs.writeFileSync(tempFilePath, 'hello world');

		try {
			// The "Upload..." item only appears on folders. Target the
			// `workspaces` folder so the upload lands there.
			const folderRow = page.locator('.explorer-folders-view .monaco-list-row[aria-label="workspaces"]');
			await expect(folderRow).toBeVisible({ timeout: 10000 });

			// Arm the file chooser handler before triggering the upload -- the
			// command synchronously opens a hidden <input type=file> and clicks it.
			const fileChooserPromise = page.waitForEvent('filechooser');

			const menu = await openExplorerContextMenu(page, folderRow);
			const uploadItem = menu.getByRole('menuitem', { name: 'Upload...' });
			await uploadItem.hover();
			await uploadItem.press('Enter');

			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles(tempFilePath);

			await toasts.expectToastWithTitle(`${fileName} upload complete`, 30000);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
			// The upload lands inside `workspaces/` -- remove it so runs stay clean.
			await cleanup.removeTestFiles([`workspaces/${fileName}`]);
		}
	});

	test('Downloading a file fires onDidDownloadFile', async function ({ app }) {
		const page = app.code.driver.currentPage;
		const { toasts } = app.workbench;

		const fileName = 'README.md';
		const fileRow = page.locator(`.explorer-folders-view .monaco-list-row[aria-label="${fileName}"]`);
		await expect(fileRow).toBeVisible({ timeout: 10000 });

		// Arm the download handler -- in web mode the command triggers an
		// <a download> click that chromium surfaces as a browser download.
		const downloadPromise = page.waitForEvent('download');

		const menu = await openExplorerContextMenu(page, fileRow);
		const downloadItem = menu.getByRole('menuitem', { name: 'Download...' });
		await downloadItem.hover();
		await downloadItem.press('Enter');

		const download = await downloadPromise;
		// We don't need the actual file -- cancel to avoid writing to disk.
		await download.cancel();

		await toasts.expectToastWithTitle(`${fileName} download complete`, 30000);
	});
});
