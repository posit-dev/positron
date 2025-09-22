/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { tags, test } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Matplotlib Interact', { tag: [tags.PLOTS, tags.NOTEBOOKS] }, () => {

	test('Python - Matplotlib Interact Test', {
		tag: [tags.CRITICAL, tags.WEB, tags.WIN],
	}, async function ({ app, hotKeys, python }) {
		const { notebooks, quickaccess } = app.positron;

		// open the Matplotlib Interact notebook and run all cells
		await quickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'matplotlib', 'interact.ipynb'));
		await notebooks.selectInterpreter('Python');
		await notebooks.runAllCells();
		await hotKeys.toggleBottomPanel();

		// interact with the sliders and verify the plot updates
		const plotLocator = notebooks.frameLocator.locator('.widget-output');
		const plotImageLocator = plotLocator.locator('img');

		const imgSrcBefore = await plotImageLocator.getAttribute('src');

		const sliders = await notebooks.frameLocator.locator('.slider-container .slider').all();
		for (const slider of sliders) {
			await slider.hover();
			await slider.click();
		}

		const imgSrcAfter = await plotImageLocator.getAttribute('src');
		expect(imgSrcBefore).not.toBe(imgSrcAfter);
	});

});
