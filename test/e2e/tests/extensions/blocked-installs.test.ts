/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});


test.describe('Extensions', {
	tag: [tags.EXTENSIONS, tags.WEB],
}, () => {

	test('Verify block of R extension installation', {
		tag: [tags.WEB_ONLY]
	}, async function ({ app }) {

		await app.workbench.extensions.installExtension('mikhail-arkhipov.r', false, true);

		// When a blocked extension install is attempted in smoke test mode, the dialog service
		// refuses to show the dialog and throws an error. This error propagates to
		// notificationService.error(), which triggers the ARIA alert mechanism. The alert
		// sets textContent (not aria-label) on the role="alert" element, so we use
		// getByRole('alert') with a text filter rather than getByLabel.
		await expect(app.code.driver.currentPage.getByRole('alert').filter({ hasText: "Cannot install the 'R Tools' extension because it conflicts with Positron built-in features" })).toBeVisible({ timeout: 15000 });

	});
});

