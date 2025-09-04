/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

// This test group aims to verify basic functionalities of Quarto for Python users
test.describe('Quarto - Python', { tag: [tags.WEB, tags.WIN, tags.QUARTO] }, () => {

	test('Verify Quarto app can render correctly with Python script', async function ({ app, openFile, python }, testInfo) {

		// This test verifies basic rendering of report in PDF after user clicks 'Preview'
		await openFile(join('workspaces', 'quarto_python', 'report.qmd'));
		await app.code.driver.page.locator('.positron-action-bar').getByRole('button', { name: 'Preview' }).click();

		// Viewer tab is targeted by corresponding iframe. It is assumed that the report fully loads once title 'Example Report' appears
		const title = app.workbench.viewer.getViewerFrame().frameLocator('iframe').getByText('Example Report');
		await expect(title).toBeVisible({ timeout: 60000 });
	});
});
