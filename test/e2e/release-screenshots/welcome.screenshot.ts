/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.describe('Release screenshots - Welcome', () => {
	test('welcome page', async ({ app, page }) => {
		await app.workbench.welcome.expectLogoToBeVisible();

		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'welcome.png');
	});
});
