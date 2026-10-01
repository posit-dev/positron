/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Side-by-Side Layout Panel', {
	tag: [tags.LAYOUTS]
}, () => {

	test('Panel stays hidden after reloading the window', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/3328' },
		],
	}, async function ({ app, hotKeys, openFile }) {
		const layouts = app.workbench.layouts;

		await layouts.enterLayout('side_by_side');
		await layouts.expectBottomPanelToBeVisible(false);

		// Reload with no editors open
		await hotKeys.reloadWindow(true);
		await layouts.expectBottomPanelToBeVisible(false);

		// Reload with an editor open
		await openFile('README.md');
		await hotKeys.reloadWindow(true);
		await layouts.expectBottomPanelToBeVisible(false);
	});

	test('Panel stays hidden after closing the last editor', async function ({ app, hotKeys, openFile }) {
		const layouts = app.workbench.layouts;

		await openFile('README.md');
		await layouts.enterLayout('side_by_side');
		await layouts.expectBottomPanelToBeVisible(false);

		await hotKeys.closeAllEditors();
		await layouts.expectBottomPanelToBeVisible(false);
	});
});
