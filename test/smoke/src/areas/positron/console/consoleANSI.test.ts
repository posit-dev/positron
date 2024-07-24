/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { join } from 'path';

export function setup(logger: Logger) {
	describe('Console ANSI styling', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('R - Console ANSI styling', () => {

			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);
				await this.app.workbench.positronLayouts.enterLayout('fullSizedPanel');
			});

			after(async function () {
				const app = this.app as Application;
				await app.workbench.positronLayouts.enterLayout('stacked');
			});

			it("R - Can produce clickable file links", async function () {
				const app = this.app as Application;

				// Can be any file on the workkspace. We use .gitignore as it's probably
				// always there.
				const fileName = '.gitignore';
				const filePath = join(app.workspacePathOrFolder, fileName);
				const inputCode = `cli::cli_inform("{.file ${filePath}}")`;

				await expect(async () => {
					await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
					await app.workbench.positronConsole.sendEnterKey();

					// Locate the link and click on it
					const link = app.workbench.positronConsole.getLastClickableLink();
					await expect(link).toContainText(fileName, { useInnerText: true });

					await link.click();
					await app.code.wait(200);

					await app.workbench.editors.waitForActiveTab(fileName);
				}).toPass({ timeout: 60000 });
			});

			it("R - Can produce clickable help links", async function () {
				const app = this.app as Application;
				const inputCode = `cli::cli_inform("{.fun base::mean}")`;

				await expect(async () => {
					await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
					await app.workbench.positronConsole.sendEnterKey();

					// Locate the link and click on it
					const link = app.workbench.positronConsole.getLastClickableLink();
					await expect(link).toContainText('base::mean', { useInnerText: true });

					await link.click();
					await app.code.wait(200);

					const helpFrame = await app.workbench.positronHelp.getHelpFrame(0);
					await expect(helpFrame.locator('body')).toContainText('Arithmetic Mean');
				}).toPass({ timeout: 60000 });
			});

			it("R - Can produce colored output", async function () {
				const app = this.app as Application;

				const color = '#ff3333';
				const rgb_color = "rgb(255, 51, 51)"; // same as above but in rgb

				await expect(async () => {
					await app.workbench.positronConsole.pasteCodeToConsole(
						`
						cli::cli_div(theme = list(span.emph = list(color = "${color}")))
						cli::cli_text("This is very {.emph important}")
						cli::cli_end()
						`
					);
				}).toPass();

				await app.workbench.positronConsole.sendEnterKey();

				const styled_locator = app.workbench.positronConsole.activeConsole.getByText("important").last();
				await expect(styled_locator).toHaveCSS('font-style', 'italic');
				await expect(styled_locator).toHaveCSS('color', rgb_color);
			});
		});
	});
}
