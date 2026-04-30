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

test.describe('Release screenshots - Launch Positron', () => {
	test('app at launch', async ({ app, page }) => {
		// On launch the Welcome tab is active by default. Verify it's there
		// so a layout regression doesn't silently produce a blank shot.
		await app.workbench.welcome.expectLogoToBeVisible();

		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'launch-positron.png');
	});
});
