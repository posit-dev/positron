/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Bottom Panel Visibility', {
	tag: [tags.WEB, tags.LAYOUTS, tags.WIN]
}, () => {

	test('Hidden panel stays hidden on closing last editor', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/pull/12644' },
		],
	}, async function ({ app, hotKeys, openFile }) {
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
