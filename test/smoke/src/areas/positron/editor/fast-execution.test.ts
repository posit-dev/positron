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

		const FILENAME = 'fast-execution.r';

		describe('R Fast Execution', () => {

			beforeEach(async function () {

				await PositronRFixtures.SetupFixtures(this.app as Application);

			});

			it('Verify fast execution is not out of order [C712539]', async function () {
				const app = this.app as Application;

				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'fast-statement-execution', FILENAME));

				let previousTop = -1;

				// Note that this outer loop iterates 10 times.  This is because the length of the
				// file fast-execution.r is 10 lines.  We want to be sure to send a Control+Enter
				// for every line of the file
				for (let i = 0; i < 10; i++) {
					let currentTop = await app.workbench.positronEditor.getCurrentLineTop();
					let retries = 20;

					// Note that top is a measurement of the distance from the top of the editor
					// to the top of the current line.  By monitoring the top value, we can determine
					// if the editor is advancing to the next line.  Without this check, the test
					// would send Control+Enter many times to the first line of the file and not
					// perform the desired test.
					while (currentTop === previousTop && retries > 0) {
						currentTop = await app.workbench.positronEditor.getCurrentLineTop();
						retries--;
					}

					previousTop = currentTop;

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
