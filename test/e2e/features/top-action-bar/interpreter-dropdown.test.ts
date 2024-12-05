/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	PositronConsole,
	PositronInterpreterDropdown,
} from '../../../automation';

import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe.skip('Interpreter Dropdown in Top Action Bar', { tag: ['@web'] }, () => {
	let interpreterDropdown: PositronInterpreterDropdown;
	let positronConsole: PositronConsole;

	test.beforeAll(async function ({ app }) {
		interpreterDropdown = app.workbench.positronInterpreterDropdown;
		positronConsole = app.workbench.positronConsole;
	});

	test('Python interpreter starts and shows running [C707212]', async function ({ app }) {
		const desiredPython = process.env.POSITRON_PY_VER_SEL!;


		// Start a Python interpreter using the interpreter dropdown
		await expect(
			async () =>
				await interpreterDropdown.selectInterpreter('Python', desiredPython)
		).toPass({ timeout: 30_000 });

		// Install ipykernel if prompted
		if (await app.workbench.positronPopups.popupCurrentlyOpen()) {
			await app.workbench.positronPopups.installIPyKernel();
		}

		// Wait for the console to be ready
		await positronConsole.waitForReady('>>>', 10_000);

		// The interpreter selected in the dropdown matches the desired interpreter
		const interpreterInfo =
			await interpreterDropdown.getSelectedInterpreterInfo();
		expect(interpreterInfo?.version).toBeDefined();
		expect(interpreterInfo!.version).toContain(desiredPython);
		expect(interpreterInfo!.path).toBeDefined();

		// The interpreter dropdown should show the expected running indicators
		await expect(async () => {
			expect(
				await interpreterDropdown.primaryInterpreterShowsRunning(
					interpreterInfo!.path
				)
			).toBe(true);
		}).toPass({ timeout: 30_000 });

		// Close the interpreter dropdown.
		await interpreterDropdown.closeInterpreterDropdown();
	});

	test('Python interpreter restarts and shows running [C707213]', async function ({ python }) {
		// Restart the active Python interpreter
		await interpreterDropdown.restartPrimaryInterpreter('Python');

		// Close the interpreter dropdown.
		await interpreterDropdown.closeInterpreterDropdown();

		// The console should indicate that the interpreter is restarting
		await positronConsole.waitForConsoleContents((contents) => {
			return (
				contents.some((line) => line.includes('preparing for restart')) &&
				contents.some((line) => line.includes('restarted'))
			);
		});

		// Wait for the console to be ready
		await positronConsole.waitForReady('>>>', 10_000);

		// The interpreter dropdown should show the expected running indicators
		await expect(async () => {
			expect(
				await interpreterDropdown.primaryInterpreterShowsRunning('Python')
			).toBe(true);
		}).toPass({ timeout: 30_000 });

		// Close the interpreter dropdown.
		await interpreterDropdown.closeInterpreterDropdown();
	});

	test('R interpreter starts and shows running [C707214]', async function () {
		const desiredR = process.env.POSITRON_R_VER_SEL!;

		// Start an R interpreter using the interpreter dropdown
		await expect(
			async () => await interpreterDropdown.selectInterpreter('R', desiredR)
		).toPass({ timeout: 30_000 });

		// Close the interpreter dropdown.
		await interpreterDropdown.closeInterpreterDropdown();

		// Wait for the console to be ready
		await positronConsole.waitForReady('>', 10_000);

		// The interpreter selected in the dropdown matches the desired interpreter
		const interpreterInfo =
			await interpreterDropdown.getSelectedInterpreterInfo();
		expect(interpreterInfo?.version).toBeDefined();
		expect(interpreterInfo!.version).toContain(desiredR);
		expect(interpreterInfo!.path).toBeDefined();

		// Close the interpreter dropdown.
		await interpreterDropdown.closeInterpreterDropdown();

		// The interpreter dropdown should show the expected running indicators
		await expect(async () => {
			expect(
				await interpreterDropdown.primaryInterpreterShowsRunning(
					interpreterInfo!.path
				)
			).toBe(true);
		}).toPass({ timeout: 30_000 });

		// Close the interpreter dropdown.
		await interpreterDropdown.closeInterpreterDropdown();
	});

	test('R interpreter stops and shows inactive [C707215]', async function ({ r }) {
		// Stop the active R interpreter
		expect(async () => {
			await interpreterDropdown.stopPrimaryInterpreter('R');
		}).toPass({ timeout: 15_000 });

		// Close the interpreter dropdown.
		await interpreterDropdown.closeInterpreterDropdown();

		// The console should indicate that the interpreter is shutting down
		await positronConsole.waitForInterpreterShutdown();

		// The interpreter dropdown should no longer show the running indicators
		expect(
			await interpreterDropdown.primaryInterpreterShowsInactive('R')
		).toBe(true);

		// Close the interpreter dropdown.
		await interpreterDropdown.closeInterpreterDropdown();
	});
});
