/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('Variables Pane', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Variables Pane', () => {

			before(async function () {

				const pythonFixtures = new PositronPythonFixtures(this.app);
				await pythonFixtures.startPythonInterpreter();

			});

			it('Verifies Variables pane basic function with python interpreter', async function () {
				const app = this.app as Application;

				const varOne = 'x=1';
				await app.workbench.positronConsole.typeToConsole(varOne);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForEndingConsoleText(varOne);

				const varTwo = 'y=10';
				await app.workbench.positronConsole.typeToConsole(varTwo);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForEndingConsoleText(varTwo);

				const varThree = 'z=100';
				await app.workbench.positronConsole.typeToConsole(varThree);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForEndingConsoleText(varThree);

				console.log('Entered lines in console defining variables');

				await app.workbench.positronConsole.logConsoleContents();

				const variablesMap = await app.workbench.positronVariables.getFlatVariables();

				expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'int' });
				expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'int' });
				expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'int' });

			});

		});

		describe('R Variables Pane', () => {

			before(async function () {

				const rFixtures = new PositronRFixtures(this.app);
				await rFixtures.startRInterpreter();

			});

			it('Verifies Variables pane basic function with R interpreter', async function () {
				const app = this.app as Application;

				const varOne = 'x=1';
				await app.workbench.positronConsole.typeToConsole(varOne);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForEndingConsoleText(varOne);

				const varTwo = 'y=10';
				await app.workbench.positronConsole.typeToConsole(varTwo);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForEndingConsoleText(varTwo);

				const varThree = 'z=100';
				await app.workbench.positronConsole.typeToConsole(varThree);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForEndingConsoleText(varThree);

				console.log('Entered lines in console defining variables');

				await app.workbench.positronConsole.logConsoleContents();

				const variablesMap = await app.workbench.positronVariables.getFlatVariables();

				expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'dbl' });
				expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'dbl' });
				expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'dbl' });

			});

		});
	});
}
