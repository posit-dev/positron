/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { test } from './pocTest';
import { PositronPythonFixtures } from '../../../automation';


test.describe('Help', () => {
	test.use({ reuseApp: true });

	test.describe('Python Help', () => {
		test('Python - Verifies basic help functionality [C633814]', async ({ app }) => {
			await PositronPythonFixtures.SetupFixtures(app);
			await app.workbench.positronConsole.executeCode('Python', `?load`, '>>>');

			await expect(async () => {
				const helpFrame = await app.workbench.positronHelp.getHelpFrame(0);
				await expect(helpFrame.locator('body')).toContainText('Load code into the current frontend.');
			}).toPass();

		});
	});

});
