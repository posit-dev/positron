/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Console } from '../../pages/console';
import { Code } from '../code';

const INTERPRETER_INFO_LINE = '.info .container .line';
const INTERPRETER_ACTIONS_SELECTOR = `.interpreter-actions .action-button`;
const DESIRED_PYTHON = process.env.POSITRON_PY_VER_SEL;
const DESIRED_R = process.env.POSITRON_R_VER_SEL;

export enum InterpreterType {
	Python = 'Python',
	R = 'R'
}

export interface InterpreterInfo {
	type: InterpreterType;
	version: string; // e.g. Python 3.12.4 64-bit or Python 3.9.19 64-bit ('3.9.19') or R 4.4.0
	path: string;    // e.g. /usr/local/bin/python3 or ~/.pyenv/versions/3.9.19/bin/python or /Library/Frameworks/R.framework/Versions/4.4-arm64/Resources/bin/R
	source?: string; // e.g. Pyenv, Global, Conda, or System
}

export class Interpreter {
	private interpreterGroups = this.code.driver.page.locator('.positron-modal-popup .interpreter-groups');
	private interpreterDropdown = this.code.driver.page.locator('.top-action-bar-interpreters-manager .left');
	private primaryInterpreter = this.code.driver.page.locator('.primary-interpreter');
	private secondaryInterpreter = this.code.driver.page.locator('.secondary-interpreter');

	constructor(private code: Code, private console: Console) { }

	// --- Actions ---

	/**
	 * Action: Start an interpreter via the Quick Access bar.
	 * @param interpreterType The type of the interpreter to start.
	 * @param waitForReady Wait for the interpreter to be ready after starting.
	 */
	startInterpreterViaQuickAccess = async (interpreterType: 'Python' | 'R', waitForReady = true) => {
		if (!DESIRED_PYTHON || !DESIRED_R) {
			throw new Error('Please set env vars: POSITRON_PYTHON_VER_SEL, POSITRON_R_VER_SEL');
		}

		await test.step(`Select interpreter via Quick Access: ${interpreterType}`, async () => {
			interpreterType === 'Python'
				? await this.console.selectInterpreter(InterpreterType.Python, DESIRED_PYTHON, waitForReady)
				: await this.console.selectInterpreter(InterpreterType.R, DESIRED_R, waitForReady);
		});
	};

	/**
	 * Action: Select an interpreter from the dropdown by the interpreter type and a descriptive string.
	 * @param interpreterType The type of the interpreter to select.
	 * @param description Description of interpreter to select: 'Python', 'R 4.4.0', '/opt/homebrew/bin/python3', etc.
	 * @param waitForReady Wait for the interpreter to be ready after selecting.
	 */
	async selectInterpreter(
		interpreterType: 'Python' | 'R',
		interpreterDescription = interpreterType === 'Python' ? DESIRED_PYTHON : DESIRED_R,
		waitForReady = true
	) {
		if (!DESIRED_PYTHON || !DESIRED_R) {
			throw new Error('Please set env vars: POSITRON_PYTHON_VER_SEL, POSITRON_R_VER_SEL');
		}

		await test.step(`Select interpreter via UI: ${interpreterDescription}`, async () => {
			await this.openInterpreterDropdown();

			const selectedPrimaryInterpreter = this.primaryInterpreter.filter({ hasText: interpreterDescription });
			const secondaryInterpreterOption = this.secondaryInterpreter.filter({ hasText: interpreterDescription });
			const primaryInterpreterByType = this.primaryInterpreter.filter({ hasText: new RegExp(`^${interpreterType}`, 'i') });

			// Wait for the primary interpreter type/group to load and be visible
			await expect(primaryInterpreterByType).toBeVisible();

			// Check if the desired interpreter is already selected in the primary group
			// Otherwise, expand the primary interpreter options and select from the secondary list
			if (await selectedPrimaryInterpreter.count() === 1) {
				await selectedPrimaryInterpreter.click();
			} else {
				primaryInterpreterByType.getByRole('button', { name: '' }).click();
				await secondaryInterpreterOption.click();
			}

			if (waitForReady) {
				interpreterType === 'Python'
					? await this.console.waitForReady('>>>', 30000)
					: await this.console.waitForReady('>', 30000);
			}
		});
	}

	/**
	 * Action: Restart the primary interpreter
	 * @param description The description of interpreter to restart: 'Python', 'R 4.4.0', '/opt/homebrew/bin/python3', etc.
	 */
	async restartPrimaryInterpreter(description: string | InterpreterType) {
		await test.step(`Restart interpreter: ${description}`, async () => {
			await this.console.barClearButton.click();

			await this.openInterpreterDropdown();
			const primaryInterpreter = await this.getPrimaryInterpreterElement(description);

			// click the restart button
			await primaryInterpreter
				.locator(INTERPRETER_ACTIONS_SELECTOR)
				.getByTitle('Restart the interpreter')
				.click();

			await this.closeInterpreterDropdown();
		});
	}

	/**
	 * Action: Stop the primary interpreter
	 * @param description The description of interpreter to stop: 'Python', 'R 4.4.0', '/opt/homebrew/bin/python3', etc.
	 */
	async stopPrimaryInterpreter(description: string | InterpreterType, waitForInterpreterShutdown = true) {
		await test.step(`Stop interpreter: ${description}`, async () => {
			await this.openInterpreterDropdown();
			const primaryInterpreter = await this.getPrimaryInterpreterElement(description);

			// click the stop button
			await primaryInterpreter
				.locator(INTERPRETER_ACTIONS_SELECTOR)
				.getByTitle('Stop the interpreter')
				.click();

			await this.closeInterpreterDropdown();

			if (waitForInterpreterShutdown) {
				await this.console.waitForInterpreterShutdown();
			}
		});
	}

	/**
	 * Action: Open the interpreter dropdown in the top action bar.
	 */
	async openInterpreterDropdown() {
		if (await this.interpreterGroups.isVisible()) {
			return;
		}

		await expect(async () => {
			await this.interpreterDropdown.click();
			await expect(this.interpreterGroups).toBeVisible();
		}).toPass();
	}

	/**
	 * Action: Close the interpreter dropdown in the top action bar.
	 */
	async closeInterpreterDropdown() {
		if (await this.interpreterGroups.isVisible()) {
			await this.code.driver.page.keyboard.press('Escape');
			await expect(this.interpreterGroups).not.toBeVisible();
		}
	}

	// --- Utils ---

	/**
	 * Util: Get the interpreter info for the currently selected interpreter in the dropdown.
	 * @returns The interpreter info for the selected interpreter if found, otherwise undefined.
	 */
	async getSelectedInterpreterInfo(): Promise<InterpreterInfo> {
		// Get the label for the selected interpreter, e.g. Python 3.10.4 (Pyenv)
		const selectedInterpreterLabel = await this.code.driver
			.page.locator('.top-action-bar-interpreters-manager')
			.getAttribute('aria-label');
		if (!selectedInterpreterLabel) {
			throw new Error('There is no selected interpreter');
		}

		await this.openInterpreterDropdown();

		// Get the selected interpreter info: name, path, type
		const selectedInterpreter = await this.getPrimaryInterpreterElement(selectedInterpreterLabel);
		const interpreterName = await this.getInterpreterName(selectedInterpreter);
		const interpreterPath = await this.getInterpreterPath(selectedInterpreter);
		const interpreterType = this.getInterpreterType(interpreterName);

		await this.closeInterpreterDropdown();

		return {
			type: interpreterType,
			version: interpreterName,
			path: interpreterPath,
		} satisfies InterpreterInfo;
	}


	// --- Helpers ---

	/**
	 * Helper: Get the primary interpreter element by a descriptive string or interpreter type.
	 * @param descriptionOrType The descriptive string or interpreter type to filter the primary interpreter by.
	 * @returns The primary interpreter element
	 */
	private async getPrimaryInterpreterElement(descriptionOrType: string | InterpreterType) {
		const expectedInterpreter = typeof descriptionOrType === 'string'
			? this.primaryInterpreter.filter({ hasText: descriptionOrType })
			: this.primaryInterpreter.filter({ hasText: new RegExp(`^${descriptionOrType}`, 'i') });

		await expect(expectedInterpreter).toBeVisible();
		return expectedInterpreter.first();
	}


	/**
	 * Helper: Get the interpreter name from the interpreter element.
	 * @param interpreterLocator The locator for the interpreter element.
	 */
	private async getInterpreterName(interpreterLocator: Locator) {
		const name = await interpreterLocator
			.locator(INTERPRETER_INFO_LINE)
			.first() // first line is the interpreter name
			.textContent();
		if (!name) {
			throw new Error('Could not retrieve interpreter name');
		}
		return name;
	}

	/**
	 * Helper: Get the interpreter path from the interpreter element.
	 * Examples: '/opt/homebrew/bin/python3', '/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources/bin/R'.
	 * @param interpreterLocator The locator for the interpreter element.
	 */
	private async getInterpreterPath(interpreterLocator: Locator) {
		const path = await interpreterLocator
			.locator(INTERPRETER_INFO_LINE)
			.last() // last line is the interpreter path
			.textContent();
		if (!path) {
			throw new Error('Could not retrieve interpreter path');
		}
		return path;
	}

	/**
	 * Helper: Determines the interpreter type based on an interpreter version string.
	 * @param version The version string to extract the interpreter type from.
	 */
	private getInterpreterType = (version: string): InterpreterType => {
		let type: InterpreterType | undefined;
		for (const [key, value] of Object.entries(InterpreterType)) {
			// Check if the versions starts with the interpreter type followed by a space
			// e.g. version = Python 3.10.4 (Pyenv) would result in InterpreterType.Python
			if (version.startsWith(`${key} `)) {
				type = value;
			}
		}
		if (!type) {
			throw new Error(`Could not determine interpreter type from version: ${version}`);
		}
		return type;
	};

	// --- Verifications ---

	/**
	 * Verify: Check if the primary interpreter shows as running with a green dot and shows a restart button.
	 * @param description The descriptive string of the interpreter to check.
	 */
	async verifyInterpreterIsRunning(description: string | InterpreterType) {
		await test.step(`Verify interpreter is running: ${description}`, async () => {
			// Get primary interpreter element
			await this.openInterpreterDropdown();
			const primaryInterpreter = await this.getPrimaryInterpreterElement(description);

			// Verify green running indicator is visible
			await expect(primaryInterpreter.locator('.running-icon')).toBeVisible();

			// Verify restart button is visible and enabled
			const restartButton = primaryInterpreter
				.locator(INTERPRETER_ACTIONS_SELECTOR)
				.getByTitle('Restart the interpreter');

			await expect(restartButton).toBeVisible();
			await expect(restartButton).toBeEnabled();

			// Verify stop button is visible and enabled
			const stopButton = primaryInterpreter
				.locator(INTERPRETER_ACTIONS_SELECTOR)
				.getByTitle('Stop the interpreter');

			await expect(stopButton).toBeVisible();
			await expect(stopButton).toBeEnabled();

			await this.closeInterpreterDropdown();
		});
	}

	/**
	 * Verify: Check if the primary interpreter has output restart info in console and is ready.
	 * @param description The descriptive string of the interpreter to check.
	 */
	async verifyInterpreterRestarted(interpreterType: 'Python' | 'R') {
		await test.step(`Verify interpreter restarted`, async () => {
			await this.console.waitForConsoleContents('preparing for restart');
			await this.console.waitForConsoleContents('restarted');

			interpreterType === 'Python'
				? await this.console.waitForReady('>>>', 10000)
				: await this.console.waitForReady('>', 10000);
		});
	}

	/**
	 * Verify: Check if the primary interpreter shows as inactive: no green dot running indicator, no restart button, and a start button.
	 * @param description The descriptive string of the interpreter to check.
	 */
	async verifyInterpreterIsInactive(description: string | InterpreterType) {
		await test.step(`Verify interpreter is inactive: ${description}`, async () => {
			// Get primary interpreter element
			await this.openInterpreterDropdown();
			const primaryInterpreter = await this.getPrimaryInterpreterElement(description);

			// Assert green running indicator is not visible
			const runningIndicator = primaryInterpreter.locator('.running-icon');
			await expect(runningIndicator).not.toBeVisible();

			// Assert restart button is not visible
			const restartButton = primaryInterpreter
				.locator(INTERPRETER_ACTIONS_SELECTOR)
				.getByTitle('Restart the interpreter');

			await expect(restartButton).not.toBeVisible();

			// Assert start button is visible and enabled
			const startButton = primaryInterpreter
				.locator(INTERPRETER_ACTIONS_SELECTOR)
				.getByTitle('Start the interpreter', { exact: true });

			await expect(startButton).toBeVisible();
			await expect(startButton).toBeEnabled();

			await this.closeInterpreterDropdown();
		});
	}

	/**
	 * Verify: the selected interpreter is the expected interpreter.
	 * @param description The descriptive string of the interpreter to verify.
	 */
	async verifyInterpreterIsSelected(description: string | InterpreterType) {
		await test.step(`Verify interpreter is selected: ${description}`, async () => {
			const interpreterInfo = await this.getSelectedInterpreterInfo();
			expect(interpreterInfo!.version).toContain(description);
		});
	}
}
