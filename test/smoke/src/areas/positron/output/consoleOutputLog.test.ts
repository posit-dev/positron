/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('Output', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Console Output Log - Python', () => {
			before(async function () {
				const app = this.app as Application;
				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();
			});

			after(async function () {
				const app = this.app as Application;
				await app.workbench.positronLayouts.enterLayout('stacked');
			});

			it('Python - Verify Console Output Log Contents [C667518]', async function () {
				const app = this.app as Application;

				const activeConsole = app.workbench.positronConsole.getActiveConsole();
				await activeConsole?.click();

				await app.workbench.positronConsole.typeToConsole('a = b');
				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronOutput.openOutputPane('Console: Python');

				await app.workbench.positronLayouts.enterLayout('fullSizedPanel');

				await app.workbench.positronOutput.waitForOutContaining("name 'b' is not defined");

			});
		});

	});

	describe('Output', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Console Output Log - R', () => {
			before(async function () {
				const app = this.app as Application;
				const rFixtures = new PositronRFixtures(app);
				await rFixtures.startRInterpreter();
			});

			after(async function () {
				const app = this.app as Application;
				await app.workbench.positronLayouts.enterLayout('stacked');
			});

			it('R - Verify Console Output Log Contents [C667519]', async function () {
				const app = this.app as Application;

				const activeConsole = app.workbench.positronConsole.getActiveConsole();
				await activeConsole?.click();

				await app.workbench.positronConsole.typeToConsole('a = b');
				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronOutput.openOutputPane('Console: R');

				await app.workbench.positronLayouts.enterLayout('fullSizedPanel');

				await app.workbench.positronOutput.waitForOutContaining("object 'b' not found");

			});
		});
	});
}
