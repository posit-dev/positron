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
				// TestRail #628634
				const app = this.app as Application;

				const executeCode = async (code: string) => {
					await app.workbench.positronConsole.executeCode('Python', code, '>>>');
				};

				await executeCode('x=1');
				await executeCode('y=10');
				await executeCode('z=100');

				console.log('Entered lines in console defining variables');

				await app.workbench.positronConsole.logConsoleContents();

				const variablesMap = await app.workbench.positronVariables.getFlatVariables();

				// need to add back when we can see types again - https://github.com/posit-dev/positron/issues/3577
				// expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'int' });
				// expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'int' });
				// expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'int' });

				expect(variablesMap.get('x')).toStrictEqual({ value: '1' });
				expect(variablesMap.get('y')).toStrictEqual({ value: '10' });
				expect(variablesMap.get('z')).toStrictEqual({ value: '100' });


			});

		});

		describe('R Variables Pane', () => {

			before(async function () {

				const rFixtures = new PositronRFixtures(this.app);
				await rFixtures.startRInterpreter();

			});

			it('Verifies Variables pane basic function with R interpreter', async function () {
				// TestRail #628635
				const app = this.app as Application;

				const executeCode = async (code: string) => {
					await app.workbench.positronConsole.executeCode('R', code, '>');
				};

				await executeCode('x=1');
				await executeCode('y=10');
				await executeCode('z=100');

				console.log('Entered lines in console defining variables');

				await app.workbench.positronConsole.logConsoleContents();

				const variablesMap = await app.workbench.positronVariables.getFlatVariables();

				// need to add back when we can see types again - https://github.com/posit-dev/positron/issues/3577
				// expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'dbl' });
				// expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'dbl' });
				// expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'dbl' });

				expect(variablesMap.get('x')).toStrictEqual({ value: '1' });
				expect(variablesMap.get('y')).toStrictEqual({ value: '10' });
				expect(variablesMap.get('z')).toStrictEqual({ value: '100' });

			});

		});
	});
}
