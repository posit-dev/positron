/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { join } from 'path';
import { Application, Logger, PositronPythonFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { expect } from '@playwright/test';

export function setup(logger: Logger) {
	describe('Shiny Application', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Shiny Application - Python', () => {
			before(async function () {
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			it('Python - Verify Basic Shiny App [...]', async function () {
				const app = this.app as Application;

				await app.workbench.extensions.installExtension('posit.shiny', true);

				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'shiny-py-example', 'app.py'));

				await app.workbench.quickaccess.runCommand('shiny.python.runApp');

				const header = app.code.driver.getFrame('.webview').frameLocator('#active-frame').locator('h1');

				const headerText = await header.innerText();

				expect(headerText).toBe('Restaurant tipping');
			});
		});
	});
}
