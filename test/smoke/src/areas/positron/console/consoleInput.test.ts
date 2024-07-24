/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { join } from 'path';

export function setup(logger: Logger) {
	describe('Console Input', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Console Input - Python', () => {
			before(async function () {
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
				await this.app.workbench.positronLayouts.enterLayout('fullSizedPanel');
			});

			after(async function () {
				const app = this.app as Application;
				await app.workbench.positronLayouts.enterLayout('stacked');
			});

			it('Python - Get Input String Console [C667516]', async function () {
				const app = this.app as Application;

				const inputCode = `val = input("Enter your name: ")
print(f'Hello {val}!')`;

				await expect(async () => {
					await app.workbench.positronConsole.pasteCodeToConsole(inputCode);

					await app.workbench.positronConsole.sendEnterKey();

					await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Enter your name:')));

					// slight wait before starting to type
					await app.code.wait(200);

					await app.workbench.positronConsole.typeToConsole('John Doe');

					await app.workbench.positronConsole.sendEnterKey();

					await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Hello John Doe!')));
				}).toPass({ timeout: 60000 });

			});
		});

		describe('Console Input - R', () => {
			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);
				await this.app.workbench.positronLayouts.enterLayout('fullSizedPanel');
			});

			after(async function () {
				const app = this.app as Application;
				await app.workbench.positronLayouts.enterLayout('stacked');
			});

			it('R - Get Input String Console [C667517]', async function () {
				const app = this.app as Application;

				const inputCode = `val <- readline(prompt = "Enter your name: ")
cat(sprintf('Hello %s!\n', val))`;

				await expect(async () => {
					await app.workbench.positronConsole.pasteCodeToConsole(inputCode);

					await app.workbench.positronConsole.sendEnterKey();

					await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Enter your name:')));

					// slight wait before starting to type
					await app.code.wait(200);

					await app.workbench.positronConsole.typeToConsole('John Doe');

					await app.workbench.positronConsole.sendEnterKey();

					await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Hello John Doe!')));
				}).toPass({ timeout: 60000 });

			});

			it('R - Can use `menu` to select alternatives', async function () {
				const app = this.app as Application;
				const inputCode = `x <- menu(letters)`;

				await expect(async () => {
					await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
					await app.workbench.positronConsole.sendEnterKey();

					await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Selection:')));

					// slight wait before starting to type
					await app.code.wait(200);

					await app.workbench.positronConsole.typeToConsole('1');
					await app.workbench.positronConsole.sendEnterKey();

					// slight wait before starting to type
					await app.code.wait(200);

					await app.workbench.positronConsole.typeToConsole('x');
					await app.workbench.positronConsole.sendEnterKey();

					await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('[1] 1')));
				}).toPass({ timeout: 60000 });
			});

			it("R - Can produce clickable links via cli", async function () {
				const app = this.app as Application;

				// Can be any file on the workkspace. We use .gitignore as it's probably
				// always there.
				const fileName = '.gitignore';
				const filePath = join(app.workspacePathOrFolder, fileName);
				const inputCode = `cli::cli_inform("{.file ${filePath}}")`;

				await expect(async () => {
					await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
					await app.workbench.positronConsole.sendEnterKey();

					const activeConsole = app.workbench.positronConsole.activeConsole;

					// Locate the link and click on it
					const link = activeConsole.locator('.output-run-hyperlink');
					expect(link).toHaveText(fileName, { useInnerText: true });

					await link.click();
					await app.code.wait(200);

					await app.workbench.editors.waitForActiveTab(fileName);
				}).toPass({ timeout: 60000 });
			});
		});
	});
}
