/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, PositronRFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';
import { join } from 'path';


describe('F1 Help #web #win #pr', () => {
	setupAndStartApp();

	describe('R F1 Help', () => {

		before(async function () {

			await PositronRFixtures.SetupFixtures(this.app as Application);

		});

		it('R - Verifies basic F1 help functionality [C1018854]', async function () {

			const app = this.app as Application;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));
			await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

			await app.workbench.positronConsole.pasteCodeToConsole('colnames(df2)');

			await app.workbench.positronConsole.doubleClickConsoleText('colnames');

			await app.workbench.positronConsole.sendKeyboardKey('F1');

			const helpFrame = await app.workbench.positronHelp.getHelpFrame(0);
			await expect(helpFrame.locator('body')).toContainText('Row and Column Names');

		});
	});

});
