/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { verifyOpenChanges, verifyOpenInNewWindow, verifyOpenViewerRendersHtml, verifyPreviewRendersHtml, verifySplitEditor, verifyToggleBreadcrumb, verifyToggleLineNumbers } from './helpers';

test.use({
	suiteId: __filename
});

test.describe('Editor Action Bar: Documents', {
	tag: [tags.WEB, tags.WIN, tags.EDITOR_ACTION_BAR, tags.EDITOR]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['editor.actionBar.enabled', 'true']], false);
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
	});

	test('R Markdown Document [C1080703]', {
		tag: [tags.R_MARKDOWN]
	}, async function ({ app, page, openFile }) {
		await openFile('workspaces/basic-rmd-file/basicRmd.rmd');
		await verifyPreviewRendersHtml(app, 'Getting startedAnchor');
		await verifySplitEditor(page, 'basicRmd.rmd');
		await verifyOpenInNewWindow(app, 'This post examines the features');
	});

	test('Quarto Document [C1080700]', {
		tag: [tags.QUARTO]
	}, async function ({ app, page, openFile }) {
		await openFile('workspaces/quarto_basic/quarto_basic.qmd');
		await verifyPreviewRendersHtml(app, 'Diamond sizes');
		await verifyOpenChanges(page);
		await verifySplitEditor(page, 'quarto_basic.qmd');
		await verifyOpenInNewWindow(app, 'Diamond sizes');
	});

	test('HTML Document [C1080701]', { tag: [tags.HTML] }, async function ({ app, page, openFile }) {
		await openFile('workspaces/dash-py-example/data/OilandGasMetadata.html');
		await verifyOpenViewerRendersHtml(app);
		await verifySplitEditor(page, 'OilandGasMetadata.html');
		await verifyOpenInNewWindow(app, '<title> Oil &amp; Gas Wells - Metadata</title>');
	});

	test('Jupyter Notebook [C1080702]', {
		tag: [tags.NOTEBOOKS],
	}, async function ({ app, page, openDataFile }) {
		await openDataFile('workspaces/large_r_notebook/spotify.ipynb');

		if (app.web) {
			await verifyToggleLineNumbers(page);
			await verifyToggleBreadcrumb(page);
		}

		await verifySplitEditor(page, 'spotify.ipynb');
	});
});

