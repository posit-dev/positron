/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});


test.describe('Extensions', {
	tag: [tags.EXTENSIONS, tags.WEB],
}, () => {

	test('Verify block of R extension installation', {
		tag: [tags.WEB_ONLY]
	}, async function ({ app }) {

		await app.positron.extensions.installExtension('mikhail-arkhipov.r', false, true);

		await expect(app.code.driver.page.getByLabel('DialogService: refused to show dialog in tests. Contents: Cannot install the \'R Tools\' extension because it conflicts with Positron built-in features').first()).toBeVisible();

	});
});

