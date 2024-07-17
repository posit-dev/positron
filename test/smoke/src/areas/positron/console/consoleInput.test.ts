/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('Console Input', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Console Input - Python', () => {
			before(async function () {
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			it('Python - Get Input String Console [C667516]', async function () {
				const app = this.app as Application;

				const inputCode = `val = input("Enter your name: ")
print(f'Hello {val}!')`;

				await app.workbench.positronConsole.pasteCodeToConsole(inputCode);

				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Enter your name:')) );

				await app.workbench.positronConsole.typeToConsole('John Doe');

				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Hello John Doe!')) );

			});
		});

		describe('Console Input - R', () => {
			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);
			});

			it('R - Get Input String Console [C667517]', async function () {
				const app = this.app as Application;

				const inputCode = `val <- readline(prompt = "Enter your name: ")
cat(sprintf('Hello %s!\n', val))`;

				await app.workbench.positronConsole.pasteCodeToConsole(inputCode);

				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Enter your name:')) );

				await app.workbench.positronConsole.typeToConsole('John Doe');

				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Hello John Doe!')) );

			});
		});
	});
}
