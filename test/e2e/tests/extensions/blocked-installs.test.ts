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

		await app.workbench.extensions.installExtension('mikhail-arkhipov.r', false, true);

		expect(app.code.driver.page.getByText('Cannot install the \'R Tools\' extension')).toBeVisible();

	});
});

