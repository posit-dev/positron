/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { test } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';

// Built via array+join because the project hygiene hook rejects source lines with
// leading spaces; each .qmd line is authored flush-left as an array element.
const HELLO_QMD = [
	'---',
	'title: "Hello, Quarto"',
	'format: html',
	'---',
	'',
	'```{python}',
	'#| label: load-packages',
	'#| include: false',
	'from plotnine import *',
	'from plotnine.data import penguins',
	'```',
	'',
	'## Meet the penguins',
	'',
	'The `penguins` data from the [plotnine](https://plotnine.org/reference/penguins.html) package contains size measurements for `{python} len(penguins)` penguins from three species observed on three islands in the Palmer Archipelago, Antarctica.',
	'',
	'@fig-plot-penguins shows the relationship between flipper and bill lengths of these penguins.',
	'',
	'```{python}',
	'#| label: fig-plot-penguins',
	'#| fig-cap: "Flipper and bill length for penguins at Palmer Station LTER"',
	'#| warning: false',
	'#| echo: false',
	'ggplot(penguins, aes(x="flipper_length_mm", y="bill_length_mm", color="species", shape="species")) + geom_point() + scale_color_manual(values=["#FF8C00", "#A020F0", "#008B8B"]) + theme_minimal()',
	'```',
	'',
].join('\n');

test.use({
	suiteId: __filename,
});

test.afterEach(async ({ hotKeys }) => {
	await hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Quarto', () => {
	/**
	 * Img Path: https://positron.posit.co/images/quarto-hello-python.png
	 *
	 * A Python Quarto document open in the editor with its rendered HTML preview
	 * (a plotnine scatter plot of the Palmer penguins) shown in the Viewer.
	 */
	test('Release Screenshot - quarto-hello-python.png', async ({ app, page, openFile, python }) => {
		const { editorActionBar, viewer, hotKeys, layouts, sessions } = app.workbench;

		// Quarto's first preview can hit a CWD path-resolution error (see the
		// retry below); recovering can take a couple of re-clicks, each of which
		// burns the inner timeout, pushing past the default 120s test timeout.
		test.setTimeout(180_000);

		await setScreenshotWindowSize(app, { width: 1200, height: 800 });
		await sessions.expectAllSessionsToBeReady();

		// Write the Quarto document to the workspace and open it in the editor
		writeFileSync(join(app.workspacePathOrFolder, 'hello.qmd'), HELLO_QMD);
		await openFile('hello.qmd');
		await hotKeys.closePrimarySidebar();

		// Render the preview. Quarto's first preview of a freshly written file can
		// fail with a path-resolution error (the preview process starts before its
		// working directory is set to the workspace, so it stats the input via a
		// bogus relative path); re-clicking Preview recovers. Retry until the
		// rendered document appears.
		const previewFrame = viewer.getViewerFrame().frameLocator('iframe');
		await expect(async () => {
			await editorActionBar.clickButton('Preview');
			await expect(previewFrame.getByRole('heading', { name: 'Meet the penguins' }))
				.toBeVisible({ timeout: 45000 });
		}).toPass({ timeout: 150000, intervals: [2000] });
		await expect(previewFrame.locator('img').first()).toBeVisible({ timeout: 30000 });

		// customize the layout
		await viewer.getViewerFrame().locator('#zoom').selectOption('100');
		await hotKeys.minimizeBottomPanel();
		await layouts.resizeAuxiliaryBar({ x: -400 });

		// capture screenshot
		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'quarto-hello-python.png');
	});
});
