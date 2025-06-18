/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto Shiny App', { tag: [tags.WEB, tags.WIN, tags.QUARTO] }, () => {
	test('Quarto Shiny App renders correctly', async ({ app, openFile }) => {
		await openFile(join('workspaces', 'quarto_shiny', 'mini-app.qmd'));
		await app.code.driver.page.getByRole('button', { name: 'Preview' }).click();
		await app.code.driver.page
			.frameLocator('iframe[name]')
			.frameLocator('iframe[title="Quarto Preview"]')
			.frameLocator('iframe')
			.getByRole('heading', { name: 'Old Faithful' })
			.waitFor({ state: 'visible', timeout: 30000 });
	});
});
