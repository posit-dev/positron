/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import {
	Application,
	PositronConsole,
	PositronInterpreterDropdown,
} from '../../../../../automation';

import { setupAndStartApp } from '../../../test-runner/test-hooks';

describe('Interpreter Dropdown in Top Action Bar #web', () => {
	setupAndStartApp();
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
		await startInterpreter(app, {
			interpreterType: 'Python',
			version: desiredPython,
			closeDropdown: false,
		});

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

	it('Python interpreter restarts and shows running [C707213]', async function () {
		await startInterpreter(app, {
			interpreterType: 'Python',
			version: desiredPython,
			closeDropdown: true,
		});

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

	it('R interpreter starts and shows running [C707214]', async function () {
		await startInterpreter(app, {
			interpreterType: 'R',
			version: desiredR,
			closeDropdown: true,
		});

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

	it('R interpreter stops and shows inactive [C707215]', async function () {
		await startInterpreter(app, {
			interpreterType: 'R',
			version: desiredR,
			closeDropdown: true,
		});

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


	async function startInterpreter(
		app: Application,
		options: { interpreterType: 'Python' | 'R'; version: string; closeDropdown: boolean }
	) {
		const expectedPrompt = options.interpreterType === 'Python' ? '>>>' : '>';
		const interpreterDropdown = app.workbench.positronInterpreterDropdown;
		const positronConsole = app.workbench.positronConsole;

		// Start the desired interpreter using the dropdown
		await interpreterDropdown.selectInterpreter(options.interpreterType, options.version);

		// Install `ipykernel` if a popup prompts for it (only applicable for Python)
		if (options.interpreterType === 'Python' && await app.workbench.positronPopups.popupCurrentlyOpen()) {
			await app.workbench.positronPopups.installIPyKernel();
		}

		// Close the interpreter dropdown if specified
		if (options.closeDropdown) {
			await interpreterDropdown.closeInterpreterDropdown();
		}

		// Wait for the console to be ready with the specified prompt
		await positronConsole.waitForReady(expectedPrompt, 10_000);
	}

});
