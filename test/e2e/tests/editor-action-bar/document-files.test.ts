/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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

	test.beforeAll(async function ({ userSettings, app }) {
		editorActionBar = app.workbench.editorActionBar;
		await userSettings.set([['editor.actionBar.enabled', 'true']], false);
	});

	test.afterEach(async function ({ runCommand }) {
		await runCommand('workbench.action.closeAllEditors');
	});

	test('R Markdown Document - verify editor action bar button behavior', {
		tag: [tags.R_MARKDOWN]
	}, async function ({ app, openFile }) {
		await openFile('workspaces/basic-rmd-file/basicRmd.rmd');
		await verifyPreviewRendersHtml('Getting startedAnchor');
		await verifySplitEditor('basicRmd.rmd');
		await verifyOpenInNewWindow(app, 'This post examines the features');
	});

	test('Quarto Document - verify editor action bar button behavior', {
		tag: [tags.QUARTO]
	}, async function ({ app, page, openFile }) {
		await openFile('workspaces/quarto_basic/quarto_basic.qmd');
		await verifyPreviewRendersHtml('Diamond sizes');
		await verifyOpenChanges(page);
		await verifySplitEditor('quarto_basic.qmd');
		await verifyOpenInNewWindow(app, 'Diamond sizes');
	});

	test('HTML Document - verify editor action bar button behavior', { tag: [tags.HTML] }, async function ({ app, page, openFile }) {
		await openFile('workspaces/dash-py-example/data/OilandGasMetadata.html');
		await verifyOpenViewerRendersHtml(app, 'Oil, Gas, and Other Regulated');
		await verifySplitEditor('OilandGasMetadata.html');
		await verifyOpenInNewWindow(app, '<title> Oil &amp; Gas Wells - Metadata</title>');
	});

	test('Jupyter Notebook - verify editor action bar button behavior', {
		tag: [tags.NOTEBOOKS],
	}, async function ({ app, page, openDataFile }) {
		await openDataFile('workspaces/large_r_notebook/spotify.ipynb');

		if (app.web) {
			await verifyToggleLineNumbers(page);
			await verifyToggleBreadcrumb(page);
		}

		await verifySplitEditor('spotify.ipynb');
	});
});


// Helper functions

async function verifyPreviewRendersHtml(heading: string) {
	await editorActionBar.clickButton('Preview');
	await editorActionBar.verifyPreviewRendersHtml(heading);
}

async function verifySplitEditor(tabName: string) {
	await editorActionBar.clickButton('Split Editor Right');
	await editorActionBar.verifySplitEditor('right', tabName);

	await editorActionBar.clickButton('Split Editor Down');
	await editorActionBar.verifySplitEditor('down', tabName);
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
		await page.getByText('date', { exact: true }).click();
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

async function verifyToggleLineNumbers(page: Page) {
	async function verifyLineNumbersVisibility(page: Page, isVisible: boolean) {
		for (const lineNum of [1, 2, 3, 4, 5]) {
			const lineNumbers = expect(page.locator('.line-numbers').getByText(lineNum.toString(), { exact: true }));
			isVisible ? await lineNumbers.toBeVisible() : await lineNumbers.not.toBeVisible();
		}
	}

	await test.step('verify "customize notebook > toggle line numbers" (web only)', async () => {
		await verifyLineNumbersVisibility(page, false);
		await editorActionBar.clickCustomizeNotebookMenuItem('Toggle Notebook Line Numbers');
		await verifyLineNumbersVisibility(page, true);
	});
}

async function verifyToggleBreadcrumb(page: Page) {
	await test.step('verify "customize notebook > toggle breadcrumbs" (web only)', async () => {
		const breadcrumbs = page.locator('.monaco-breadcrumbs');

		await expect(breadcrumbs).toBeVisible();
		await editorActionBar.clickCustomizeNotebookMenuItem('Toggle Breadcrumbs');
		await expect(breadcrumbs).not.toBeVisible();
	});
}
