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
} from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 * Interpreter Dropdown in Top Action Bar test cases
 */
export function setup(logger: Logger) {
	describe('Interpreter Dropdown in Top Action Bar', () => {
		/**
		 * NOTE: This describe block MUST RUN FIRST, before any of the other tests in this suite.
		 * This unfortunately cannot be run in the 'before' block of the following describe block,
		 * because the app restart interferes with the timing of the tests (the app is not ready
		 * when the tests start).
		 */
		describe('Interpreter Dropdown in Top Action Bar - setup', async () => {
			// Shared before/after handling
			installAllHandlers(logger);

			let app: Application;
			let userSettings: PositronUserSettingsFixtures;

			before(async function () {
				app = this.app as Application;
				userSettings = new PositronUserSettingsFixtures(app);
			});

			it('Disable automatic startup of interpreters', async function () {
				// Disable automatic startup of interpreters to prevent the auto-started interpreter from
				// bulldozing the interpreter dropdown selection
				await userSettings.setUserSetting([
					'positron.interpreters.automaticStartup',
					'false',
				]);
			});
		});

		describe('Interpreter Dropdown in Top Action Bar', () => {
			// Shared before/after handling
			installAllHandlers(logger);

			let app: Application;
			let interpreterDropdown: PositronInterpreterDropdown;
			let positronConsole: PositronConsole;
			let desiredPython: string;
			let desiredR: string;

			before(async function () {
				app = this.app as Application;
				interpreterDropdown = app.workbench.positronInterpreterDropdown;
				positronConsole = app.workbench.positronConsole;
				desiredPython = process.env.POSITRON_PY_VER_SEL!;
				desiredR = process.env.POSITRON_R_VER_SEL!;
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
				await positronConsole.waitForConsoleContents((contents) =>
					contents.some((line) => line.includes('shut down successfully'))
				);

				// The interpreter dropdown should no longer show the running indicators
				expect(
					await interpreterDropdown.primaryInterpreterShowsInactive('R')
				).toBe(true);
			});
		});

		/**
		 * NOTE: This describe block MUST RUN LAST, after any of the other tests in this suite.
		 * This unfortunately cannot be run in the 'after' block of the previous describe block,
		 * as Positron closes before or while the after block is running.
		 */
		describe('Interpreter Dropdown in Top Action Bar - cleanup', async () => {
			// Shared before/after handling
			installAllHandlers(logger);

			let app: Application;
			let userSettings: PositronUserSettingsFixtures;

			before(async function () {
				app = this.app as Application;
				userSettings = new PositronUserSettingsFixtures(app);
			});

			it('Unset user settings', async function () {
				// Unset the user setting to re-enable automatic startup of interpreters
				await userSettings.unsetUserSettings();
			});
		});
	});
}
