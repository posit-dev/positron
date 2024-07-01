/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Application, Logger, PositronPythonFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';


export function setup(logger: Logger) {
	describe('Console', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Console Clipboard', () => {

			before(async function () {

				const app = this.app as Application;

				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();

			});

			it.only('Python - Copy from console', async function () {

				// TestRail
				const app = this.app as Application;

				console.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('Python', 'a = b', '>>>');

				await app.workbench.positronConsole.waitForConsoleContents(((contents) => contents.some((line) => line.includes('NameError'))));

				console.log('debug');

			});
		});
	});
}
