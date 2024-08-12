/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { Application, Logger, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { expect } from '@playwright/test';

/*
 * R console tests
 */
export function setup(logger: Logger) {
	describe('Editor Pane: R', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('R Fast Execution', () => {

			beforeEach(async function () {

				await PositronRFixtures.SetupFixtures(this.app as Application);

			});

			it('Verify fast execution is not out of order [C712539]', async function () {
				const app = this.app as Application;

				await app.code.driver.setViewportSize({ width: 1400, height: 1000 });

				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'fast-statement-execution', 'fast-execution.r'));

				for (let i = 0; i < 11; i++) {
					await app.code.driver.getKeyboard().press('Control+Enter');
				}

				// give variables a little time to update as we were trying to
				// run as quickly as possible above
				await app.code.wait(1000);

				const variablesMap = await app.workbench.positronVariables.getFlatVariables();

				await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');

				expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'dbl' });
				expect(variablesMap.get('y')).toStrictEqual({ value: '1', type: 'dbl' });
				expect(variablesMap.get('z')).toStrictEqual({ value: '1', type: 'dbl' });
				expect(variablesMap.get('a')).toStrictEqual({ value: '1', type: 'dbl' });
				expect(variablesMap.get('b')).toStrictEqual({ value: '1', type: 'dbl' });
				expect(variablesMap.get('c')).toStrictEqual({ value: '1', type: 'dbl' });
			});
		});
	});
}
