/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Bottom Panel Visibility', {
	tag: [tags.WEB, tags.LAYOUTS, tags.WIN]
}, () => {

	test('Visible panel maximizes on closing last editor', async function ({ app, hotKeys, openFile }) {
		const layouts = app.workbench.layouts;

		// Open a file in editor - panel should be visible
		await openFile('README.md');
		await layouts.expectBottomPanelToBeVisible(true);

		// Get initial panel height
		const initialPanelHeight = await layouts.boundingBoxProperty(layouts.panel, 'height');

		// Close all editors - panel should maximize
		await hotKeys.closeAllEditors();
		await layouts.expectBottomPanelToBeVisible(true);
		const expandedPanelHeight = await layouts.boundingBoxProperty(layouts.panel, 'height');
		expect(expandedPanelHeight).toBeGreaterThan(initialPanelHeight);
	});

	test('Hidden panel stays hidden on closing last editor', async function ({ app, hotKeys, openFile }) {
		const layouts = app.workbench.layouts;

		// Open a file in editor - panel should be visible
		await openFile('README.md');
		await layouts.expectBottomPanelToBeVisible(true);

		// Hide the panel explicitly
		await hotKeys.toggleBottomPanel();
		await layouts.expectBottomPanelToBeVisible(false);

		// Close all editors - panel should remain hidden
		await hotKeys.closeAllEditors();
		await layouts.expectBottomPanelToBeVisible(false);

		// Reload the window - panel should still be hidden after reload
		await hotKeys.reloadWindow(true);
		await layouts.expectBottomPanelToBeVisible(false);
	});
});
