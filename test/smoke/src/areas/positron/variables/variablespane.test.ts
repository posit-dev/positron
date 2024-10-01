/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../positronUtils';



describe('Variables Pane #web #win', () => {
	const logger = setupAndStartApp();

	describe('Python Variables Pane #web #pr', () => {

		before(async function () {

			await PositronPythonFixtures.SetupFixtures(this.app as Application);

		});

		beforeEach(async function () {
			await this.app.workbench.positronLayouts.enterLayout('stacked');

		});

		it('Verifies Variables pane basic function with python interpreter [C628634]', async function () {
			const app = this.app as Application;

			const executeCode = async (code: string) => {
				await app.workbench.positronConsole.executeCode('Python', code, '>>>');
			};

			await executeCode('x=1');
			await executeCode('y=10');
			await executeCode('z=100');

			logger.log('Entered lines in console defining variables');

			await app.workbench.positronConsole.logConsoleContents();

			await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');

			const variablesMap = await app.workbench.positronVariables.getFlatVariables();

			expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'int' });
			expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'int' });
			expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'int' });

		});

	});

	describe('R Variables Pane #web #pr', () => {

		before(async function () {
			await PositronRFixtures.SetupFixtures(this.app as Application);

		});

		beforeEach(async function () {
			await this.app.workbench.positronLayouts.enterLayout('stacked');

		});

		it('Verifies Variables pane basic function with R interpreter [C628635]', async function () {
			const app = this.app as Application;

			const executeCode = async (code: string) => {
				await app.workbench.positronConsole.executeCode('R', code, '>');
			};

			await executeCode('x=1');
			await executeCode('y=10');
			await executeCode('z=100');

			logger.log('Entered lines in console defining variables');

			await app.workbench.positronConsole.logConsoleContents();

			await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');

			const variablesMap = await app.workbench.positronVariables.getFlatVariables();

			expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'dbl' });
			expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'dbl' });
			expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'dbl' });
		});

	});
});
