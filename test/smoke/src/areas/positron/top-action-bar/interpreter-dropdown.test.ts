/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, Logger, PositronInterpreterDropdown } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 * Interpreter Dropdown in Top Action Bar test cases
 */
export function setup(logger: Logger) {
	describe('Interpreter Dropdown in Top Action Bar', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		let app: Application;
		let interpreterDropdown: PositronInterpreterDropdown;
		let desiredPython: string;
		let desiredR: string;

		before(async function () {
			app = this.app as Application;
			interpreterDropdown = app.workbench.positronInterpreterDropdown;
			desiredPython = process.env.POSITRON_PY_VER_SEL!;
			desiredR = process.env.POSITRON_R_VER_SEL!;
		});

		it('Start an interpreter - Python', async function () {
			// Start a Python interpreter using the interpreter dropdown
			await expect(
				async () =>
					await interpreterDropdown.selectInterpreter('Python', desiredPython)
			).toPass({ timeout: 15_000 });

			// Install ipykernel if prompted
			if (await this.app.workbench.positronPopups.popupCurrentlyOpen()) {
				await this.app.workbench.positronPopups.installIPyKernel();
			}

			// Wait for the console to be ready
			await app.workbench.positronConsole.waitForReady('>>>', 10000);

			// The interpreter selected in the dropdown matches the desired interpreter
			const interpreterInfo = await interpreterDropdown.getSelectedInterpreterInfo();
			expect(interpreterInfo?.version).toBeDefined();
			expect(interpreterInfo!.version).toContain(desiredPython);
			expect(interpreterInfo!.path).toBeDefined();

			// The interpreter dropdown should show the expected running indicators
			expect(
				await interpreterDropdown.primaryInterpreterShowsRunning(
					interpreterInfo!.path
				)
			).toBe(true);
		});

		it('Start an interpreter - R', async function () {
			// Start an R interpreter using the interpreter dropdown
			await expect(
				async () =>
					await interpreterDropdown.selectInterpreter('R', desiredR)
			).toPass({ timeout: 15_000 });

			// Wait for the console to be ready
			await app.workbench.positronConsole.waitForReady('>', 10000);

			// The interpreter selected in the dropdown matches the desired interpreter
			const interpreterInfo = await interpreterDropdown.getSelectedInterpreterInfo();
			expect(interpreterInfo?.version).toBeDefined();
			expect(interpreterInfo!.version).toContain(desiredR);
			expect(interpreterInfo!.path).toBeDefined();

			// The interpreter dropdown should show the expected running indicators
			expect(
				await interpreterDropdown.primaryInterpreterShowsRunning(
					interpreterInfo!.path
				)
			).toBe(true);
		});

		// it('Restart the active interpreter', async function () {
		// 	// Now, restart the active interpreter
		// 	// The console should indicate that the interpreter is restarting
		// 	// The console should indicate that the interpreter has restarted
		// 	// The interpreter dropdown should show the expected running indicators
		// });

		// it('Stop the active interpreter', async function () {
		// 	// Now, stop the active interpreter
		// 	// The console should indicate that the interpreter is exiting
		// 	// The interpreter dropdown should no longer show the running indicators
		// });
	});
}

