/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { join } from 'path';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation/out';
import { installAllHandlers } from '../../../utils';
import { expect } from '@playwright/test';
import * as path from 'path';

export function setup(logger: Logger) {
	describe('Shiny Application', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		before(async function () {
			await this.app.workbench.extensions.installExtension('posit.shiny', true);

			await this.app.workbench.extensions.closeExtension('Shiny');
		});

		describe('Shiny Application - Python', () => {
			before(async function () {
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			it('Python - Verify Basic Shiny App [...]', async function () {
				const app = this.app as Application;

				await app.workbench.positronConsole.typeToConsole(`pip install -r ${path.join('workspaces', 'shiny-py-example', 'requirements.txt')}`);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForReady('>>>', 2000);
				await app.workbench.positronConsole.barRestartButton.click();
				await app.workbench.positronConsole.waitForReady('>>>');
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));

				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'shiny-py-example', 'app.py'));

				await app.workbench.quickaccess.runCommand('shiny.python.runApp');

				const headerLocator = app.workbench.positronViewer.getViewerLocator('h1');

				const headerText = await headerLocator.innerText();

				expect(headerText).toBe('Restaurant tipping');

				await app.workbench.positronTerminal.sendKeysToTerminal('Control+C');

				await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('Application shutdown complete.')));

				await app.code.waitAndClick('.codicon-positron-refresh');
			});
		});

		describe('Shiny Application - R', () => {
			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);
			});

			it('R - Verify Basic Shiny App [...]', async function () {
				const app = this.app as Application;

				await app.workbench.positronConsole.typeToConsole('install.packages("shiny")');
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForReady('>', 2000);
				await app.workbench.positronConsole.barRestartButton.click();
				await app.workbench.positronConsole.waitForReady('>');
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));

				const code = `library(shiny)
runExample("01_hello")`;

				await app.workbench.positronConsole.pasteCodeToConsole(code);

				await app.workbench.positronConsole.sendEnterKey();

				const headerLocator = app.workbench.positronViewer.getViewerLocator('h1');

				const headerText = await headerLocator.innerText();

				expect(headerText).toBe('Hello Shiny!');

				await app.workbench.positronTerminal.clickTerminalTab();

				await app.workbench.positronTerminal.sendKeysToTerminal('Control+C');

				await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('Application shutdown complete.')));

				await app.code.waitAndClick('.codicon-positron-refresh');

			});
		});
	});
}
