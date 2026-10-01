/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { Application } from '../../infra';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Bottom Panel Size', {
	tag: [tags.LAYOUTS]
}, () => {

	test('Panel size is kept after visiting a project with no open editors', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/2033' },
		],
	}, async function ({ app, openFile }) {
		const layouts = app.workbench.layouts;

		// An empty sibling project: it opens with no editors, so the panel is maximized there
		const workspaceFolder = app.workspacePathOrFolder;
		const otherFolder = path.join(path.dirname(workspaceFolder), 'panel-size-other-project');
		fs.mkdirSync(otherFolder, { recursive: true });

		// Open a file and give the panel a custom height
		await openFile('README.md');
		await layouts.resizePanelToHeight(200);
		const panelHeight = await layouts.boundingBoxProperty(layouts.panel, 'height');

		// Switch to the empty project and back
		await openFolderByPath(app, otherFolder);
		await openFolderByPath(app, workspaceFolder);

		// The panel should be restored to the custom height
		await expect.poll(async () =>
			Math.abs(await layouts.boundingBoxProperty(layouts.panel, 'height') - panelHeight)
		).toBeLessThanOrEqual(1);
	});
});

/**
 * Opens a folder by typing its absolute path into the Open Folder picker. The openFolder fixture
 * can only descend from the workspace root, so it can't reach a sibling folder or return to the
 * workspace from one.
 */
async function openFolderByPath(app: Application, folderPath: string): Promise<void> {
	await test.step(`Open folder: ${folderPath}`, async () => {
		const quickInput = app.workbench.quickInput;
		await app.workbench.hotKeys.openFolder();
		await expect(quickInput.quickInputList.locator('a').filter({ hasText: '..' })).toBeVisible();
		await quickInput.type(folderPath + '/');
		await quickInput.clickOkButton();

		// Wait for the workbench to re-render after the folder switch
		await app.code.driver.currentPage.waitForTimeout(3000);
		await app.code.driver.currentPage.locator('.monaco-workbench').waitFor({ state: 'visible' });
	});
}
