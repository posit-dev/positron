/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('R Code Actions', { tag: [tags.CONSOLE, tags.WIN, tags.WEB] }, () => {

	test("R - Can insert a Roxygen skeleton", async function ({ app, r, openFile }) {

		const fileName = 'supermarket-sales.r';
		await openFile(join('workspaces/read-xlsx-r/', fileName));

		const termLocator = await app.workbench.editor.clickOnTerm(fileName, 'get_data_from_excel', 7, true);

		await termLocator.hover();

		await app.code.driver.page.locator('.codicon-light-bulb').click();

		const generateTemplate = app.code.driver.page.getByText('Generate a roxygen template');

		await expect(async () => {

			try {
				await generateTemplate.hover({ timeout: 2000 });
				await generateTemplate.click({ timeout: 2000 });
			} catch (e) {
				// workaround for click problem
				await app.code.driver.page.mouse.move(0, 0);
				throw e;
			}
		}).toPass({ timeout: 30000 });

		const line7 = await app.workbench.editor.getLine(fileName, 7);
		expect(line7).toBe('#\' Title');

		const line12 = await app.workbench.editor.getLine(fileName, 12);
		expect(line12).toBe('#\' @examples');

	});
});

