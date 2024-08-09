/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import {
	Application,
	Logger,
	PositronConsole,
	PositronInterpreterDropdown,
	PositronUserSettingsFixtures,
	QuickAccess,
} from '../../../../../automation';
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
		let positronConsole: PositronConsole;
		let quickaccess: QuickAccess;
		let userSettings: PositronUserSettingsFixtures;
		let desiredPython: string;
		let desiredR: string;

		before(async function () {
			app = this.app as Application;
			interpreterDropdown = app.workbench.positronInterpreterDropdown;
			positronConsole = app.workbench.positronConsole;
			quickaccess = app.workbench.quickaccess;
			userSettings = new PositronUserSettingsFixtures(app);
			desiredPython = process.env.POSITRON_PY_VER_SEL!;
			desiredR = process.env.POSITRON_R_VER_SEL!;

			/**
			 * Ensure that no interpreters are running before starting the tests. This is necessary
			 * because interactions with the interpreter dropdown to select an interpreter can get
			 * bulldozed by automatic interpreter startup.
			 */

			// Wait for the console to be ready
			await positronConsole.waitForReadyOrNoInterpreter();

			try {
				// If no interpreters are running, we're good to go
				await positronConsole.waitForNoInterpretersRunning(50);
				return;
			} catch (error) {
				// If an interpreter is running, we'll shut it down and disable automatic startup

				// Shutdown running interpreter
				await quickaccess.runCommand('workbench.action.languageRuntime.shutdown');
				await positronConsole.waitForInterpreterShutdown();

				// Disable automatic startup of interpreters in user settings. This setting will be
				// cleared in the next app startup for a subsequent test, so we don't need to unset
				// it.
				await userSettings.setUserSetting([
					'positron.interpreters.automaticStartup',
					'false',
				]);

				// Reload the window
				// keepOpen is set to true so we don't need to wait for the prompt input to close
				// (it will never close since the app gets reloaded)
				await quickaccess.runCommand('workbench.action.reloadWindow', { keepOpen: true });
			}
		});

		it('Python interpreter starts and shows running [C707212]', async function () {
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
			await positronConsole.waitForReady('>>>', 10000);

			// The interpreter selected in the dropdown matches the desired interpreter
			const interpreterInfo =
				await interpreterDropdown.getSelectedInterpreterInfo();
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

		it('Python interpreter restarts and shows running [C707213]', async function () {
			// NOTE: This test is dependent on 'Python interpreter starts and shows running' having run successfully

			// Restart the active Python interpreter
			await interpreterDropdown.restartPrimaryInterpreter('Python');

			// The console should indicate that the interpreter is restarting
			await positronConsole.waitForConsoleContents((contents) => {
				return (
					contents.some((line) => line.includes('preparing for restart')) &&
					contents.some((line) => line.includes('restarted'))
				);
			});

			// Wait for the console to be ready
			await positronConsole.waitForReady('>>>', 10000);

			// The interpreter dropdown should show the expected running indicators
			expect(
				await interpreterDropdown.primaryInterpreterShowsRunning('Python')
			).toBe(true);
		});

		it('R interpreter starts and shows running [C707214]', async function () {
			// Start an R interpreter using the interpreter dropdown
			await expect(
				async () => await interpreterDropdown.selectInterpreter('R', desiredR)
			).toPass({ timeout: 15_000 });

			// Wait for the console to be ready
			await positronConsole.waitForReady('>', 10000);

			// The interpreter selected in the dropdown matches the desired interpreter
			const interpreterInfo =
				await interpreterDropdown.getSelectedInterpreterInfo();
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

		it('R interpreter stops and shows inactive [C707215]', async function () {
			// NOTE: This test is dependent on 'R interpreter starts and shows running' having run successfully

			// Stop the active R interpreter
			expect(async () => {
				await interpreterDropdown.stopPrimaryInterpreter('R');
			}).toPass({ timeout: 15_000 });

			// The console should indicate that the interpreter is shutting down
			await positronConsole.waitForInterpreterShutdown();

			// The interpreter dropdown should no longer show the running indicators
			expect(
				await interpreterDropdown.primaryInterpreterShowsInactive('R')
			).toBe(true);
		});
	});
}
