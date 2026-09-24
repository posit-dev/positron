/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { writeFileSync } from 'fs';
import { join } from 'path';
import { test } from '../../tests/quarto/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { hideDataGridCursor, prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';

// Built via array+join because the project hygiene hook rejects source lines with
// leading spaces; each .qmd line is authored flush-left as an array element.
const PENGUINS_QMD = [
	'---',
	'title: "Palmer Penguins"',
	'format: html',
	'---',
	'',
	'```{python}',
	'from plotnine import *',
	'from plotnine.data import penguins',
	'penguins = penguins.dropna()',
	'(',
	'\tggplot(penguins, aes("flipper_length_mm", "bill_length_mm", color="species"))',
	'\t+ geom_point()',
	'\t+ theme_minimal()',
	'\t+ theme(figure_size=(6, 3))',
	')',
	'```',
	'',
].join('\n');

test.use({
	suiteId: __filename,
});

test.afterEach(async ({ hotKeys, cleanup }) => {
	await hotKeys.closeAllEditors();
	await cleanup.removeTestFiles(['penguins.qmd']);
});

test.describe('Release Screenshots - Quarto Inline Output', () => {
	/**
	 * Img Path: https://positron.posit.co/images/quarto-inline-output.png
	 *
	 * A Python Quarto document with inline output enabled, showing a plotnine
	 * scatter plot rendered directly beneath its cell.
	 */
	test('Release Screenshot - quarto-inline-output.png', async ({ app, page, openFile, python }) => {
		const { editors, inlineQuarto, hotKeys } = app.workbench;

		await setScreenshotWindowSize(app, { width: 1050, height: 860 });

		writeFileSync(join(app.workspacePathOrFolder, 'penguins.qmd'), PENGUINS_QMD);
		await openFile('penguins.qmd');
		await editors.waitForActiveTab('penguins.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		await inlineQuarto.runAllCells();
		await inlineQuarto.expectOutputsExist(1, 60000);
		await inlineQuarto.expectOutputVisible({ index: 0 });

		// customize the layout
		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
		await hotKeys.minimizeBottomPanel();
		await inlineQuarto.gotoLine(1);

		// capture screenshot
		await hideDataGridCursor(page);
		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'quarto-inline-output.png');
	});
});
