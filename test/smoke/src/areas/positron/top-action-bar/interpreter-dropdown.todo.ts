// /*---------------------------------------------------------------------------------------------
//  *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
//  *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
//  *--------------------------------------------------------------------------------------------*/

// import { test, expect } from '../_test.setup';
// import { PositronConsole, PositronInterpreterDropdown, PositronUserSettingsFixtures, QuickAccess } from '../../../../automation';

// test.use({
// 	suiteId: __filename
// });

// test.../../../../../automation/outr Dropdown in Top Action Bar #web', () => {
// 	let interpreterDropdown: PositronInterpreterDropdown;
// 	let positronConsole: PositronConsole;
// 	let quickaccess: QuickAccess;
// 	let userSettings: PositronUserSettingsFixtures;
// 	let desiredPython: string;
// 	let desiredR: string;

// 	test.beforeAll(async function ({ app }) {
// 		interpreterDropdown = app.workbench.positronInterpreterDropdown;
// 		positronConsole = app.workbench.positronConsole;
// 		quickaccess = app.workbench.quickaccess;
// 		userSettings = new PositronUserSettingsFixtures(app);
// 		desiredPython = process.env.POSITRON_PY_VER_SEL!;
// 		desiredR = process.env.POSITRON_R_VER_SEL!;
// 	});

// 	test('Python interpreter starts and shows running [C707212]', async function ({ app, python }) {
// 		// Start a Python interpreter using the interpreter dropdown
// 		await interpreterDropdown.selectInterpreter('Python', desiredPython);

// 		// Install ipykernel if prompted
// 		if (await app.workbench.positronPopups.popupCurrentlyOpen()) {
// 			await app.workbench.positronPopups.installIPyKernel();
// 		}

// 		// The interpreter selected in the dropdown matches the desired interpreter
// 		const interpreterInfo =
// 			await interpreterDropdown.getSelectedInterpreterInfo();
// 		expect(interpreterInfo?.version).toBeDefined();
// 		expect(interpreterInfo!.version).toContain(desiredPython);
// 		expect(interpreterInfo!.path).toBeDefined();

// 		// The interpreter dropdown should show the expected running indicators
// 		await expect(async () => {
// 			expect(
// 				await interpreterDropdown.primaryInterpreterShowsRunning(
// 					interpreterInfo!.path
// 				)
// 			).toBe(true);
// 		}).toPass({ timeout: 30_000 });

// 		// Close the interpreter dropdown.
// 		await interpreterDropdown.closeInterpreterDropdown();
// 	});

// 	test('Python interpreter restarts and shows running [C707213]', async function ({ app, python }) {
// 		// Restart the active Python interpreter
// 		await interpreterDropdown.restartPrimaryInterpreter('Python');

// 		// Close the interpreter dropdown.
// 		await interpreterDropdown.closeInterpreterDropdown();

// 		// The console should indicate that the interpreter is restarting
// 		await positronConsole.waitForConsoleContents((contents) => {
// 			return (
// 				contents.some((line) => line.includes('preparing for restart')) &&
// 				contents.some((line) => line.includes('restarted'))
// 			);
// 		});

// 		// Wait for the console to be ready
// 		await positronConsole.waitForReady('>>>', 10_000);

// 		// The interpreter dropdown should show the expected running indicators
// 		await expect(async () => {
// 			expect(
// 				await interpreterDropdown.primaryInterpreterShowsRunning('Python')
// 			).toBe(true);
// 		}).toPass({ timeout: 30_000 });

// 		// Close the interpreter dropdown.
// 		await interpreterDropdown.closeInterpreterDropdown();
// 	});

// 	test('R interpreter starts and shows running [C707214]', async function ({ app, r }) {
// 		// The interpreter selected in the dropdown matches the desired interpreter
// 		const interpreterInfo =
// 			await interpreterDropdown.getSelectedInterpreterInfo();
// 		expect(interpreterInfo?.version).toBeDefined();
// 		expect(interpreterInfo!.version).toContain(desiredR);
// 		expect(interpreterInfo!.path).toBeDefined();

// 		// Close the interpreter dropdown.
// 		await interpreterDropdown.closeInterpreterDropdown();

// 		// The interpreter dropdown should show the expected running indicators
// 		await expect(async () => {
// 			expect(
// 				await interpreterDropdown.primaryInterpreterShowsRunning(
// 					interpreterInfo!.path
// 				)
// 			).toBe(true);
// 		}).toPass({ timeout: 30_000 });

// 		// Close the interpreter dropdown.
// 		await interpreterDropdown.closeInterpreterDropdown();
// 	});

// 	test('R interpreter stops and shows inactive [C707215]', async function ({ app, r }) {
// 		// Stop the active R interpreter
// 		expect(async () => {
// 			await interpreterDropdown.stopPrimaryInterpreter('R');
// 		}).toPass({ timeout: 15_000 });

// 		// Close the interpreter dropdown.
// 		await interpreterDropdown.closeInterpreterDropdown();

// 		// The console should indicate that the interpreter is shutting down
// 		await positronConsole.waitForInterpreterShutdown();

// 		// The interpreter dropdown should no longer show the running indicators
// 		expect(
// 			await interpreterDropdown.primaryInterpreterShowsInactive('R')
// 		).toBe(true);

// 		// Close the interpreter dropdown.
// 		await interpreterDropdown.closeInterpreterDropdown();
// 	});
// });
