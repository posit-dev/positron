/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import test, { expect, Locator } from '@playwright/test';
import { Code, Console } from '../infra';
import { getInterpreterType, InterpreterInfo, InterpreterType } from './utils/interpreterInfo';

const INTERPRETER_INFO_LINE = '.info .container .line';
const INTERPRETER_ACTIONS_SELECTOR = `.interpreter-actions .action-button`;


/*
 *  Reuseable Positron interpreter selection functionality for tests to leverage.
 */
export class Interpreter {
	private interpreterGroups = this.code.driver.page.locator('.positron-modal-popup .interpreter-groups');
	private interpreterDropdown = this.code.driver.page.locator('.top-action-bar-interpreters-manager .left');
	private primaryInterpreter = this.code.driver.page.locator('.primary-interpreter');
	private secondaryInterpreter = this.code.driver.page.locator('.secondary-interpreter');

	constructor(private code: Code, private console: Console) { }

	/**
	 * Open the interpreter dropdown in the top action bar.
	 */
	async openInterpreterDropdown() {
		// await test.step(`Open interpreter dropdown`, async () => {
		// If the interpreter dropdown is already open, return. This is a necessary check because
		// clicking an open interpreter dropdown will close it.
		if (await this.interpreterGroups.isVisible()) {
			return;
		}

		// Open the interpreter dropdown.

		await expect(async () => {
			await this.interpreterDropdown.click({ timeout: 10_000 });
			await expect(this.interpreterGroups).toBeVisible();
		}).toPass();
		// });
	}

	/**
	 * Close the interpreter dropdown in the top action bar.
	 */
	async closeInterpreterDropdown() {
		// await test.step(`Open interpreter dropdown`, async () => {
		if (await this.interpreterGroups.isVisible()) {
			await this.code.driver.page.keyboard.press('Escape');
			await expect(this.interpreterGroups).not.toBeVisible();
		}
		// });
	}

	/**
	 * Get the interpreter name from the interpreter element.
	 * Examples: 'Python 3.10.4 (Pyenv)', 'R 4.4.0'.
	 * @param interpreterLocator The locator for the interpreter element.
	 * @returns The interpreter name if found, otherwise undefined.
	 */
	private async getInterpreterName(interpreterLocator: Locator) {
		// The first line element in the interpreter group contains the interpreter name.
		return await interpreterLocator
			.locator(INTERPRETER_INFO_LINE)
			.first()
			.textContent();
	}

	/**
	 * Get the interpreter path from the interpreter element.
	 * Examples: '/opt/homebrew/bin/python3', '/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources/bin/R'.
	 * @param interpreterLocator The locator for the interpreter element.
	 * @returns The interpreter path if found, otherwise undefined.
	 */
	private async getInterpreterPath(interpreterLocator: Locator) {
		// The last line element in the interpreter group contains the interpreter path.
		return await interpreterLocator
			.locator(INTERPRETER_INFO_LINE)
			.last()
			.textContent();
	}

	/**
	 * Get the primary interpreter element by a descriptive string or interpreter type.
	 * The string could be 'Python 3.10.4 (Pyenv)', 'R 4.4.0', '/opt/homebrew/bin/python3', etc.
	 * @param description The descriptive string of the interpreter to get.
	 * @returns The primary interpreter element if found, otherwise undefined.
	 */
	private async getPrimaryInterpreter(description: string | InterpreterType) {
		const expectedInterpreter = this.primaryInterpreter.filter({ hasText: description });
		await expect(expectedInterpreter).toBeVisible();
		return expectedInterpreter.first();
	}


	/**
	 * Restart the primary interpreter corresponding to the interpreter type or a descriptive string.
	 * The interpreter type could be 'Python', 'R', etc.
	 * The string could be 'Python 3.10.4 (Pyenv)', 'R 4.4.0', '/opt/homebrew/bin/python3', etc.
	 * Note: This assumes the interpreter is already running.
	 */
	async restartPrimaryInterpreter(description: string | InterpreterType) {
		// await test.step(`Restart interpreter: ${description}`, async () => {
		await this.openInterpreterDropdown();
		const primaryInterpreter = await this.getPrimaryInterpreter(description);

		// click the restart button
		await primaryInterpreter
			.locator(INTERPRETER_ACTIONS_SELECTOR)
			.getByTitle('Restart the interpreter')
			.click();

		await this.closeInterpreterDropdown();
		// });
	}

	/**
	 * Stop the primary interpreter corresponding to the interpreter type or a descriptive string.
	 * The interpreter type could be 'Python', 'R', etc.
	 * The string could be 'Python 3.10.4 (Pyenv)', 'R 4.4.0', '/opt/homebrew/bin/python3', etc.
	 * Note: This expects the interpreter to already running.
	 */
	async stopPrimaryInterpreter(description: string | InterpreterType) {
		// // await test.step(`Stop interpreter: ${description}`, async () => {

		await this.openInterpreterDropdown();

		const primaryInterpreter = await this.getPrimaryInterpreter(description);

		const stopButton = primaryInterpreter
			.locator(INTERPRETER_ACTIONS_SELECTOR)
			.getByTitle('Stop the interpreter');
		await stopButton.click();
		// return;

		await this.closeInterpreterDropdown();
	}

	/**
	 * Check if the primary interpreter shows as running with a green dot and shows a restart button.
	 * @param description The descriptive string of the interpreter to check.
	 */
	async verifyInterpreterIsRunning(description: string | InterpreterType) {
		await test.step(`Verify interpreter is running: ${description}`, async () => {
			// Get primary interpreter element
			await this.openInterpreterDropdown();
			const primaryInterpreter = await this.getPrimaryInterpreter(description);

			// Fail if green dot running indicator missing
			await expect(primaryInterpreter.locator('.running-icon')).toBeVisible();

			// Fail if restart button not visible and enabled
			const restartButton = primaryInterpreter
				.locator(INTERPRETER_ACTIONS_SELECTOR)
				.getByTitle('Restart the interpreter');

			await expect(restartButton).toBeVisible();
			await expect(restartButton).toBeEnabled();

			// Fail if stop button not visible and enabled
			const stopButton = primaryInterpreter
				.locator(INTERPRETER_ACTIONS_SELECTOR)
				.getByTitle('Stop the interpreter');

			await expect(stopButton).toBeVisible();
			await expect(stopButton).toBeEnabled();

			await this.closeInterpreterDropdown();
		});
	}

	async verifyInterpreterRestarted(interpreterType: 'Python' | 'R') {
		await this.console.waitForConsoleContents('preparing for restart');
		await this.console.waitForConsoleContents('restarted');

		interpreterType === 'Python'
			? await this.console.waitForReady('>>>', 10000)
			: await this.console.waitForReady('>', 10000);
	}

	/**
	 * Check if the primary interpreter shows as inactive with a restart button and a start button.
	 * @param description The descriptive string of the interpreter to check.
	 * @returns True if the primary interpreter shows the expected inactive UI elements, otherwise false.
	 */
	async verifyInterpreterIsInactive(description: string | InterpreterType) {
		// await test.step(`Verify interpreter is inactive: ${description}`, async () => {
		// Get primary interpreter element
		await this.openInterpreterDropdown();
		const primaryInterpreter = await this.getPrimaryInterpreter(description);

		// Fail if green dot running indicator not missing
		const runningIndicator = primaryInterpreter.locator('.running-icon');
		await expect(runningIndicator).not.toBeVisible();

		// Fail if restart button not disabled or missing
		// const restartButton = primaryInterpreter
		// 	.locator(INTERPRETER_ACTIONS_SELECTOR)
		// 	.getByTitle('Restart the interpreter');

		// await expect(restartButton).toBeVisible();
		// await expect(restartButton).toBeDisabled();

		// Fail if start button not visible or enabled
		const startButton = primaryInterpreter
			.locator(INTERPRETER_ACTIONS_SELECTOR)
			.getByTitle('Start the interpreter', { exact: true });

		await expect(startButton).toBeVisible();
		await expect(startButton).toBeEnabled();

		await this.closeInterpreterDropdown();
		// });
	}

	/**
	 * Verify the selected interpreter is the expected interpreter.
	 * @param description The descriptive string of the interpreter to verify.
	 */
	async verifyInterpreterIsSelected(description: string | InterpreterType) {
		const interpreterInfo = await this.getSelectedInterpreterInfo();
		expect(interpreterInfo!.version).toContain(description);
	}

	/**
	 * Select an interpreter from the dropdown by the interpreter type and a descriptive string.
	 * The interpreter type could be 'Python', 'R', etc.
	 * The string could be 'Python 3.10.4 (Pyenv)', 'R 4.4.0', '/opt/homebrew/bin/python3', etc.
	 * @param type The interpreter type to select.
	 * @param description The descriptive string of the interpreter to select.
	 * @returns A promise that resolves once the interpreter is selected.
	 */
	async selectInterpreter(type: 'Python' | 'R', description: string) {
		// await test.step(`Select interpreter: ${description}`, async () => {
		await this.openInterpreterDropdown();
		const matchingPrimary = this.primaryInterpreter.filter({ hasText: description });
		const matchingSecondary = this.secondaryInterpreter.filter({ hasText: description });

		if (await matchingPrimary.count() > 0) {
			// desired interpreter is already primary interpreter
			await matchingPrimary.first().click();
		} else {
			// find the desired interpreter in the secondary interpreters
			const ellipsisButtons = this.primaryInterpreter.getByRole('button', { name: '' });
			const count = await ellipsisButtons.count();

			for (let i = 0; i < count; i++) {
				await ellipsisButtons.nth(i).click();
			}
			await matchingSecondary.click();
		}

		type === 'Python'
			? await this.console.waitForReady('>>>', 10000)
			: await this.console.waitForReady('>', 10000);
		// });
	}

	/**
	 * Get the interpreter info for the currently selected interpreter in the dropdown.
	 * @returns The interpreter info for the selected interpreter if found, otherwise undefined.
	 */
	async getSelectedInterpreterInfo(): Promise<InterpreterInfo | undefined> {
		// return await test.step('Get selected interpreter info', async () => {

		// Get the label for the selected interpreter, e.g. Python 3.10.4 (Pyenv)
		const currentInterpreterLabel = await this.code.driver
			.page.locator('.top-action-bar-interpreters-manager')
			.getAttribute('aria-label');
		if (!currentInterpreterLabel) {
			throw new Error('There is no selected interpreter');
		}

		// Open the interpreter manager
		await this.openInterpreterDropdown();

		// Get the primary interpreter element
		const currentInterpreter = await this.getPrimaryInterpreter(
			currentInterpreterLabel
		);

		// Get the interpreter name
		const interpreterName = await this.getInterpreterName(
			currentInterpreter
		);
		if (!interpreterName) {
			throw new Error(
				`Could not retrieve interpreter name for ${currentInterpreterLabel}`
			);
		}

		// Get the interpreter path
		const interpreterPath = await this.getInterpreterPath(
			currentInterpreter
		);
		if (!interpreterPath) {
			throw new Error(
				`Could not retrieve interpreter path for ${currentInterpreterLabel}`
			);
		}

		// Determine the interpreter type for the selected interpreter
		const interpreterType = getInterpreterType(interpreterName);
		if (!interpreterType) {
			throw new Error(
				`Could not determine interpreter type for ${currentInterpreterLabel}`
			);
		}

		// Close the interpreter dropdown
		await this.closeInterpreterDropdown();

		// Return the interpreter info
		return {
			type: interpreterType,
			version: interpreterName,
			path: interpreterPath,
		} satisfies InterpreterInfo;
		// });
	}
}
