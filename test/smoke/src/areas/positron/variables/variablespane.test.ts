/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, Logger } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('Variables Pane', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		it('Verifies Variables pane basic function with python interpreter', async function () {
			const app = this.app as Application;

			const desiredPython = process.env.POSITRON_PY_VER_SEL || '3.10.12 (PyEnv)';
			await app.workbench.startInterpreter.selectInterpreter('Python', desiredPython);

			// noop if dialog does not appear
			await app.workbench.positronPopups.installIPyKernel();

			await app.workbench.positronConsole.waitForStarted();

			await app.workbench.positronConsole.logConsoleContents();

			await app.workbench.positronConsole.typeToConsole('x=1\ny=10\nz=100\n');

			console.log('Entered lines in console defining variables');

			await app.workbench.positronConsole.logConsoleContents();

			const variablesMap = await app.workbench.positronVariables.getFlatVariables();

			expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'int' });
			expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'int' });
			expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'int' });

		});

		it('Verifies Variables pane basic function with R interpreter', async function () {
			const app = this.app as Application;

			const desiredR = process.env.POSITRON_R_VER_SEL || 'R 4.3.3';
			await app.workbench.startInterpreter.selectInterpreter('R', desiredR);

			await app.code.wait(2000);

			await app.workbench.positronConsole.waitForStarted();

			await app.workbench.positronConsole.logConsoleContents();

			await app.workbench.positronConsole.typeToConsole('x=1\ny=10\nz=100\n');

			console.log('Entered lines in console defining variables');

			await app.workbench.positronConsole.logConsoleContents();

			const variablesMap = await app.workbench.positronVariables.getFlatVariables();

			expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'dbl' });
			expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'dbl' });
			expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'dbl' });

		});
	});
}
