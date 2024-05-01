/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, Logger } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { fail } from 'assert';

export function setup(logger: Logger) {
	describe('Variables Pane', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		it('Verifies Variables pane basic function with python interpreter', async function () {
			const app = this.app as Application;

			const desiredPython = process.env.POSITRON_PY_VER_SEL;
			if (desiredPython === undefined) {
				fail('Please be sure to set env var POSITRON_PY_VER_SEL to the UI text corresponding to the Python version for the test');
			}
			await app.workbench.startInterpreter.selectInterpreter('Python', desiredPython);

			// noop if dialog does not appear
			await app.workbench.positronPopups.installIPyKernel();

			await app.workbench.positronConsole.waitForStarted('>>>');

			await app.workbench.positronConsole.logConsoleContents();

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

		it('Verifies Variables pane basic function with R interpreter', async function () {
			const app = this.app as Application;

			const desiredR = process.env.POSITRON_R_VER_SEL;
			if (desiredR === undefined) {
				fail('Please be sure to set env var POSITRON_R_VER_SEL to the UI text corresponding to the R version for the test');
			}
			await app.workbench.startInterpreter.selectInterpreter('R', desiredR);

			await app.workbench.positronConsole.waitForStarted('>');

			await app.workbench.positronConsole.logConsoleContents();

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
}
