/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	PositronConsole,
	PositronInterpreterDropdown,
} from '../../../automation';

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Interpreter Dropdown in Top Action Bar with PET', { tag: [tags.WEB, tags.TOP_ACTION_BAR] }, () => {
	let interpreterDropdown: PositronInterpreterDropdown;
	let positronConsole: PositronConsole;

	test.beforeAll(async function ({ app }) {
		interpreterDropdown = app.workbench.positronInterpreterDropdown;
		positronConsole = app.workbench.positronConsole;
	});

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['python.locator', 'native']]);
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
		await positronConsole.waitForConsoleContents('preparing for restart');
		await positronConsole.waitForConsoleContents('restarted');

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
});
