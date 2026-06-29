/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const STATUS_ITEM = '.statusbar-item[id="positron.nextEditSuggestions.statusBarEntry"]';
const DASHBOARD = '.next-edit-suggestions-status-tooltip';

test.describe('Next Edit Suggestions: Status Bar', {
	tag: [tags.WEB, tags.WIN, tags.ASSISTANT]
}, () => {
	// The Next Edit Suggestions extension activates onStartupFinished and sets the
	// `nextEditSuggestions.enabled` context key.
	//
	// TODO: once the `ai.enabled` setting exists, add a test asserting that with
	// `ai.enabled: false` the status bar item does not appear (see the matching TODO in
	// extensions/next-edit-suggestions/src/extension.ts).

	test('Status bar item appears and opens its dashboard on hover', async function ({ page }) {
		const statusItem = page.locator(STATUS_ITEM);
		await expect(statusItem).toBeVisible();

		await statusItem.hover();

		await expect(page.locator(DASHBOARD)).toBeVisible();
	});
});
