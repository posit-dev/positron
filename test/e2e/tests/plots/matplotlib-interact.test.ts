/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { tags, test } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Matplotlib Interact', { tag: [tags.PLOTS, tags.NOTEBOOKS] }, () => {

	// Q: Does the Positron notebook editor support interactive ipywidget output (matplotlib
	// interact sliders updating the plot)? The widgets render, but the output <img> is not
	// reachable through the editor's webview frames. Verify, then unskip.
	test.skip('Python - Matplotlib Interact Test', {
		tag: [tags.WEB, tags.WIN]
	}, async function ({ app, hotKeys, python }) {
		const { notebooksPositron, quickaccess } = app.workbench;

		// open the Matplotlib Interact notebook and run all cells
		await quickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'matplotlib', 'interact.ipynb'));
		await notebooksPositron.kernel.select('Python');

		await hotKeys.closeSecondarySidebar();

		await notebooksPositron.clickActionBarButtton('Run All');
		await notebooksPositron.expectNoActiveSpinners(30000);
		await hotKeys.toggleBottomPanel();

		// interact with the sliders and verify the plot updates
		const plotLocator = notebooksPositron.frameLocator.locator('.widget-output');
		const plotImageLocator = plotLocator.locator('img');

		const imgSrcBefore = await plotImageLocator.getAttribute('src');

		const sliders = await notebooksPositron.frameLocator.locator('.slider-container .slider').all();
		for (const slider of sliders) {
			await slider.hover();
			await slider.click();
		}

		const imgSrcAfter = await plotImageLocator.getAttribute('src');
		expect(imgSrcBefore).not.toBe(imgSrcAfter);
	});

});
