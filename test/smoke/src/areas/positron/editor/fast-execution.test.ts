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

	// does not pass on Ubuntu CI runner as execution is too fast
	// keeping for OSX and Windows execution
	describe.skip('Editor Pane: R', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		const FILENAME = 'fast-execution.r';

		describe('R Fast Execution', () => {

			beforeEach(async function () {

				await PositronRFixtures.SetupFixtures(this.app as Application);

			});

			it('Verify fast execution is not out of order [C712539]', async function () {
				const app = this.app as Application;

				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'fast-statement-execution', FILENAME));

				for (let i = 1; i < 12; i++) {
					await app.code.driver.getKeyboard().press('Control+Enter');
				}

				await app.workbench.positronVariables.waitForVariableRow('c');

				await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');

				const variablesMap = await app.workbench.positronVariables.getFlatVariables();

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
