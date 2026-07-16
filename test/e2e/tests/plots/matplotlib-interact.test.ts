/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Matplotlib Interact', { tag: [tags.PLOTS, tags.POSITRON_NOTEBOOKS] }, () => {

	test('Python - Matplotlib Interact Test', {
		tag: [tags.WEB, tags.WIN],
	}, async function ({ app, hotKeys, python }) {
		const { notebooksPositron, quickaccess } = app.workbench;

		// open the Matplotlib Interact notebook and run all cells
		await quickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'matplotlib', 'interact.ipynb'));
		await notebooksPositron.kernel.select('Python');

		await hotKeys.closeSecondarySidebar();

		await notebooksPositron.clickActionBarButtton('Run All Cells');
		await notebooksPositron.expectNoActiveSpinners(30000);
		await hotKeys.toggleBottomPanel();

		// Scroll the output into view to claim its overlay webview, else the frame is empty.
		await notebooksPositron.cellOutput(0).scrollIntoViewIfNeeded();

		const plotImage = notebooksPositron.frameLocator.locator('.widget-output img');
		const radiusReadout = notebooksPositron.widgetReadout.first();
		const radiusSlider = notebooksPositron.widgetSlider.first();

		// interact() defers the first render: the plot is absent until a slider moves.
		await expect(radiusReadout).toHaveText('1.00');
		await expect(plotImage).toHaveCount(0);

		// Retry the keypress until the value changes (a single press can precede focus).
		await radiusSlider.click();
		await expect(async () => {
			await radiusSlider.press('ArrowRight');
			await expect(radiusReadout).not.toHaveText('1.00');
			await expect(plotImage).toBeVisible();
		}).toPass({ timeout: 30000 });

		expect(await plotImage.getAttribute('src')).toMatch(/^data:image\/png/);
	});

});
