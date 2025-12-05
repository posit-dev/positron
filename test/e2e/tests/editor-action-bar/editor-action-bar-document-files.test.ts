/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Editor Action Bar: Document Files
 *
 * This test suite validates the functionality of the Editor Action Bar when interacting with
 * various types of files (R Markdown, Quarto, HTML, and Jupyter Notebooks, etc.)
 *
 * Flow:
 * - Open a supported file type
 * - Interact with action bar controls to preview or split the editor
 * - Verify content is rendered or shown in a new editor/tab/window as expected
 * - Confirm expected visibility/invisibility of the action bar based on file type
 */

import { expect, Page } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { EditorActionBar } from '../../pages/editorActionBar';
import { Application } from '../../infra';

let editorActionBar: EditorActionBar;

test.use({
	suiteId: __filename
});

test.describe('Editor Action Bar: Document Files', {
	tag: [tags.WEB, tags.WIN, tags.EDITOR_ACTION_BAR, tags.EDITOR]
}, () => {

	test.beforeAll(async function ({ app }) {
		editorActionBar = app.workbench.editorActionBar;
	});

	test.afterEach(async function ({ runCommand }) {
		await runCommand('workbench.action.closeAllEditors');
	});

	test('R Markdown Document - Verify `preview`, `split editor`, `open in new window` behavior', {
		tag: [tags.R_MARKDOWN]
	}, async function ({ app, openFile }) {
		await openFile('workspaces/basic-rmd-file/basicRmd.rmd');
		await verifyPreviewRendersHtml('Getting startedAnchor');
		await verifySplitEditor('basicRmd.rmd');
		await verifyOpenInNewWindow(app, 'This post examines the features');
	});

	test('Quarto Document - Verify `preview`, `split editor`, `open in new window` behavior', {
		tag: [tags.QUARTO]
	}, async function ({ app, page, openFile }) {
		await openFile('workspaces/quarto_basic/quarto_basic.qmd');
		await verifyPreviewRendersHtml('Diamond sizes');
		await verifyOpenChanges(page);
		await verifySplitEditor('quarto_basic.qmd');
		await verifyOpenInNewWindow(app, 'Diamond sizes');
	});

	test('HTML Document - Verify `open viewer`, `split editor`, `open in new window` behavior', { tag: [tags.HTML] }, async function ({ app, openFile }) {
		await openFile('workspaces/dash-py-example/data/OilandGasMetadata.html');
		await verifyOpenViewerRendersHtml(app, 'Oil, Gas, and Other Regulated');
		await verifySplitEditor('OilandGasMetadata.html');
		await verifyOpenInNewWindow(app, '<title> Oil &amp; Gas Wells - Metadata</title>');
	});
});


// Helper functions

async function verifyPreviewRendersHtml(heading: string) {
	// await editorActionBar.clickButton('Preview');
	await editorActionBar.verifyPreviewRendersHtml(heading);
}

async function verifySplitEditor(tabName: string) {
	await editorActionBar.clickButton('Split Editor Right');
	await editorActionBar.verifySplitEditor('right', tabName);

	await expect(async () => {
		await editorActionBar.clickButton('Split Editor Down');
		await editorActionBar.verifySplitEditor('down', tabName);
	}).toPass({ timeout: 30000 });
}

async function verifyOpenInNewWindow(app: Application, text: string) {
	await editorActionBar.verifyOpenInNewWindow(app.web, text, false);
}

async function verifyOpenViewerRendersHtml(app: Application, title: string) {
	await editorActionBar.clickButton('Open in Viewer');
	await editorActionBar.verifyOpenViewerRendersHtml(app.web, title);
}

async function verifyOpenChanges(page: Page) {
	await test.step('verify "open changes" shows diff', async () => {
		async function bindPlatformHotkey(page: Page, key: string) {
			await page.keyboard.press(process.platform === 'darwin' ? `Meta+${key}` : `Control+${key}`);
		}

		// make change & save
		await page.locator('[id="workbench\\.parts\\.editor"]').getByText('date').click();
		await page.keyboard.press('X');
		await bindPlatformHotkey(page, 'S');

		// click open changes & verify
		await editorActionBar.clickButton('Open Changes');
		await expect(page.getByLabel('Revert Block')).toBeVisible();
		await expect(page.getByLabel('Stage Block')).toBeVisible();
		await page.getByRole('tab', { name: 'quarto_basic.qmd (Working' }).getByLabel('Close').click();

		// undo changes & save
		await bindPlatformHotkey(page, 'Z');
		await bindPlatformHotkey(page, 'S');
	});
}

