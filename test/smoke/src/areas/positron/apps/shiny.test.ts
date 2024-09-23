/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { join } from 'path';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { expect } from '@playwright/test';

export function setup(logger: Logger) {
	describe('Shiny Application', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		before(async function () {
			try {
				await this.app.workbench.extensions.installExtension('posit.shiny', true);
				await this.app.workbench.extensions.closeExtension('Shiny');
			} catch (e) {
				this.app.code.driver.takeScreenshot('shinySetup');
				throw e;
			}
		});

		describe('Shiny Application - Python', () => {
			before(async function () {
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			it('Python - Verify Basic Shiny App [C699099]', async function () {
				const app = this.app as Application;

				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'shiny-py-example', 'app.py'));

				await app.workbench.quickaccess.runCommand('shiny.python.runApp');

				const headerLocator = app.workbench.positronViewer.getViewerLocator('h1');

				await expect(headerLocator).toHaveText('Restaurant tipping', { timeout: 20000 });

				await app.workbench.positronTerminal.sendKeysToTerminal('Control+C');

				await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('Application shutdown complete.')));

				// refresh the viewer so the shutdown Python app goes away before we kick off the R app
				await app.workbench.positronViewer.refreshViewer();
			});
		});

		describe('Shiny Application - R', () => {
			before(async function () {
				// setup R but do not wait for a default interpreter to finish starting
				await PositronRFixtures.SetupFixtures(this.app as Application, true);
			});

			it('R - Verify Basic Shiny App [C699100]', async function () {
				const app = this.app as Application;

				const code = `library(shiny)
runExample("01_hello")`;

				await app.workbench.positronConsole.pasteCodeToConsole(code);

				await app.workbench.positronConsole.sendEnterKey();

				const headerLocator = app.workbench.positronViewer.getViewerLocator('h1');

				await expect(headerLocator).toHaveText('Hello Shiny!', { timeout: 20000 });

				await app.workbench.positronConsole.activeConsole.click();
				await app.workbench.positronConsole.sendKeyboardKey('Control+C');

				// not strictly needed yet, but in case another case is added later afterwards
				// make sure that the shut down R app is not present
				await app.workbench.positronViewer.refreshViewer();

			});
		});
	});
}
