/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import { Code } from '../code';
import { getInterpreterType, InterpreterInfo, InterpreterType } from './utils/positronInterpreterInfo';

const INTERPRETER_INFO_LINE = '.info .container .line';
const INTERPRETER_ACTIONS_SELECTOR = `.interpreter-actions .action-button`;

/*
 *  Reuseable Positron interpreter selection functionality for tests to leverage.
 */
export class PositronInterpreterDropdown {
	private interpreterGroups = this.code.driver.getLocator(
		'.positron-modal-popup .interpreter-groups'
	);
	private interpreterDropdown = this.code.driver.getLocator(
		'.top-action-bar-interpreters-manager .left'
	);

	constructor(private code: Code) { }

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
		// Wait for the primary interpreters to load
		await this.code.waitForElements('.primary-interpreter', false);
		const allPrimaryInterpreters = await this.interpreterGroups
			.locator('.primary-interpreter')
			.all();
		if (allPrimaryInterpreters.length === 0) {
			this.code.logger.log('Failed to locate primary interpreters');
			return undefined;
		}

		// Look for a primary interpreter that matches the provided description
		for (const interpreter of allPrimaryInterpreters) {
			// Try to match on interpreter name
			const interpreterName = await this.getInterpreterName(interpreter);
			if (!interpreterName) {
				// Shouldn't happen, but if it does, proceed to the next interpreter
				continue;
			}
			if (description in InterpreterType) {
				// Examples:
				// - starts with Python - 'Python 3.10.4 (Pyenv)'
				// - starts with R - 'R 4.4.0'
				if (interpreterName.startsWith(`${description} `)) {
					return interpreter;
				}
			}
			if (interpreterName.includes(description)) {
				// Example: includes 3.10.4 - 'Python 3.10.4 (Pyenv)'
				return interpreter;
			}

			// Try to match on interpreter path
			const interpreterPath = await this.getInterpreterPath(interpreter);
			if (!interpreterPath) {
				// Shouldn't happen, but if it does, proceed to the next interpreter
				continue;
			}
			if (interpreterPath.includes(description)) {
				// Example: includes /opt/homebrew/bin/python3
				return interpreter;
			}
		}

		// No primary interpreters match the provided description
		this.code.logger.log(`No primary interpreters match the provided description: ${description}`);
		return undefined;
	}

	/**
	 * Get the secondary interpreters for the primary interpreter locator.
	 * @param primaryInterpreter The locator for the primary interpreter element.
	 * @returns The secondary interpreter elements if found, otherwise an empty array.
	 */
	private async getSecondaryInterpreters(primaryInterpreter: Locator) {
		// Click the 'Show all versions' ... button for the primary interpreter group
		const showAllVersionsButton = primaryInterpreter
			.locator(INTERPRETER_ACTIONS_SELECTOR)
			.getByTitle('Show all versions');
		await showAllVersionsButton.click();

		// Wait for the secondary interpreters to load
		await this.code.waitForElements('.secondary-interpreter', false);
		return await this.interpreterGroups
			.locator('.secondary-interpreter')
			.all();
	}

	/**
	 * Open the interpreter dropdown in the top action bar.
	 * @returns A promise that resolves once the interpreter dropdown is open.
	 */
	async openInterpreterDropdown() {
		// If the interpreter dropdown is already open, return. This is a necessary check because
		// clicking an open interpreter dropdown will close it.
		if (await this.interpreterGroups.isVisible()) {
			return;
		}

		// Open the interpreter dropdown.
		await this.interpreterDropdown.click({ timeout: 10_000 });
		await this.interpreterGroups.waitFor({ state: 'attached', timeout: 10_000 });
	}

	/**
	 * Close the interpreter dropdown in the top action bar.
	 * @returns A promise that resolves once the interpreter dropdown is closed.
	 */
	async closeInterpreterDropdown() {
		if (await this.interpreterGroups.isVisible()) {
			await this.code.driver.getKeyboard().press('Escape');
			await this.interpreterGroups.waitFor({ state: 'detached', timeout: 10_000 });
		}
	}

	/**
	 * Restart the primary interpreter corresponding to the interpreter type or a descriptive string.
	 * The interpreter type could be 'Python', 'R', etc.
	 * The string could be 'Python 3.10.4 (Pyenv)', 'R 4.4.0', '/opt/homebrew/bin/python3', etc.
	 * Note: This assumes the interpreter is already running.
	 */
	async restartPrimaryInterpreter(description: string | InterpreterType) {
		await this.openInterpreterDropdown();

		const primaryInterpreter = await this.getPrimaryInterpreter(description);
		if (!primaryInterpreter) {
			await this.closeInterpreterDropdown();
			throw new Error(`Could not find primary interpreter with description '${description}'`);
		}

		const restartButton = primaryInterpreter
			.locator(INTERPRETER_ACTIONS_SELECTOR)
			.getByTitle('Restart the interpreter');
		await restartButton.click();
	}

	/**
	 * Stop the primary interpreter corresponding to the interpreter type or a descriptive string.
	 * The interpreter type could be 'Python', 'R', etc.
	 * The string could be 'Python 3.10.4 (Pyenv)', 'R 4.4.0', '/opt/homebrew/bin/python3', etc.
	 * Note: This expects the interpreter to already running.
	 */
	async stopPrimaryInterpreter(description: string | InterpreterType) {
		await this.openInterpreterDropdown();

		const primaryInterpreter = await this.getPrimaryInterpreter(description);
		if (!primaryInterpreter) {
			await this.closeInterpreterDropdown();
			throw new Error(`Could not find primary interpreter with description '${description}'`);
		}

		if (await this.primaryInterpreterShowsRunning(description)) {
			const stopButton = primaryInterpreter
				.locator(INTERPRETER_ACTIONS_SELECTOR)
				.getByTitle('Stop the interpreter');
			await stopButton.click();
			return;
		}

		await this.closeInterpreterDropdown();
		throw new Error(`Interpreter '${description}' is not running -- cannot stop an inactive interpreter`);
	}

	/**
	 * Check if the primary interpreter shows as running with a green dot and shows a restart button.
	 * @param description The descriptive string of the interpreter to check.
	 * @returns True if the primary interpreter shows the expected running UI elements, otherwise false.
	 */
	async primaryInterpreterShowsRunning(
		description: string | InterpreterType
	) {
		await this.openInterpreterDropdown();

		const primaryInterpreter = await this.getPrimaryInterpreter(
			description
		);
		if (!primaryInterpreter) {
			throw new Error(`Could not find primary interpreter with description '${description}'`);
		}

		// Fail if green dot running indicator missing
		const runningIndicator = primaryInterpreter.locator('.running-icon');
		if (!(await runningIndicator.isVisible())) {
			return false;
		}

		// Fail if restart button not visible and enabled
		const restartButton = primaryInterpreter
			.locator(INTERPRETER_ACTIONS_SELECTOR)
			.getByTitle('Restart the interpreter');
		if (
			!(await restartButton.isVisible()) ||
			!(await restartButton.isEnabled())
		) {
			return false;
		}

		// Fail if stop button not visible and enabled
		const stopButton = primaryInterpreter
			.locator(INTERPRETER_ACTIONS_SELECTOR)
			.getByTitle('Stop the interpreter');
		if (
			!(await stopButton.isVisible()) ||
			!(await stopButton.isEnabled())
		) {
			return false;
		}

		// Success if all checks pass
		return true;
	}

	/**
	 * Check if the primary interpreter shows as inactive with a restart button and a start button.
	 * @param description The descriptive string of the interpreter to check.
	 * @returns True if the primary interpreter shows the expected inactive UI elements, otherwise false.
	 */
	async primaryInterpreterShowsInactive(
		description: string | InterpreterType
	) {
		await this.openInterpreterDropdown();

		const primaryInterpreter = await this.getPrimaryInterpreter(
			description
		);
		if (!primaryInterpreter) {
			await this.closeInterpreterDropdown();
			throw new Error(`Could not find primary interpreter with description '${description}'`);
		}

		// Fail if green dot running indicator not missing
		const runningIndicator = primaryInterpreter.locator('.running-icon');
		if (await runningIndicator.isVisible()) {
			return false;
		}

		// Fail if restart button not disabled or missing
		const restartButton = primaryInterpreter
			.locator(INTERPRETER_ACTIONS_SELECTOR)
			.getByTitle('Restart the interpreter');
		if (
			(await restartButton.isVisible()) &&
			!(await restartButton.isDisabled())
		) {
			return false;
		}

		// Fail if start button not visible or enabled
		const startButton = primaryInterpreter
			.locator(INTERPRETER_ACTIONS_SELECTOR)
			.getByTitle(
				'Start the interpreter',
				{
					// Because 'Start the interpreter` is a substring of `Restart the interpreter`,
					// and, by default, getByTitle performs a case-insensitive / partial match,
					// specify that an exact match is required so we don't return multiple buttons.
					exact: true
				}
			);
		if (!(await startButton.isVisible()) || !(await startButton.isEnabled())) {
			return false;
		}

		// Success if all checks pass
		return true;
	}

	/**
	 * Select an interpreter from the dropdown by the interpreter type and a descriptive string.
	 * The interpreter type could be 'Python', 'R', etc.
	 * The string could be 'Python 3.10.4 (Pyenv)', 'R 4.4.0', '/opt/homebrew/bin/python3', etc.
	 * @param desiredInterpreterType The interpreter type to select.
	 * @param desiredInterpreterString The descriptive string of the interpreter to select.
	 * @returns A promise that resolves once the interpreter is selected.
	 */
	async selectInterpreter(
		desiredInterpreterType: string,
		desiredInterpreterString: string
	) {
		// Open the interpreter dropdown
		await this.openInterpreterDropdown();

		// Get the primary interpreter element corresponding to the desired interpreter type
		const primaryInterpreter = await this.getPrimaryInterpreter(
			desiredInterpreterType
		);
		if (!primaryInterpreter) {
			// No primary interpreters match the language runtime
			throw new Error(
				`Could not find primary interpreter with type ${desiredInterpreterType}`
			);
		}
		const primaryInterpreterName = await this.getInterpreterName(
			primaryInterpreter
		);
		if (!primaryInterpreterName) {
			throw new Error(
				`Could not retrieve interpreter name for ${desiredInterpreterType}`
			);
		}

		// If the primary interpreter matches the desired interpreter string, select the interpreter
		if (primaryInterpreterName.includes(desiredInterpreterString)) {
			this.code.logger.log(
				`Found primary interpreter: ${primaryInterpreterName}`
			);
			await primaryInterpreter.click();
			return;
		}

		// If the primary interpreter does not match the desired interpreter string, look for a matching secondary interpreter
		this.code.logger.log(
			'Primary interpreter did not match. Looking for secondary interpreters...'
		);
		const secondaryInterpreters = await this.getSecondaryInterpreters(
			primaryInterpreter
		);
		if (secondaryInterpreters.length === 0) {
			throw new Error(
				`Could not find secondary interpreters for ${desiredInterpreterType}`
			);
		}
		// Look for the desired interpreter string in the secondary interpreters
		for (const secondaryInterpreter of secondaryInterpreters) {
			const secondaryInterpreterName = await this.getInterpreterName(
				secondaryInterpreter
			);
			if (!secondaryInterpreterName) {
				// This shouldn't happen, but if it does, warn and proceed to the next secondary interpreter
				this.code.logger.log(
					'WARNING: could not retrieve interpreter name for secondary interpreter'
				);
				continue;
			}
			// If the secondary interpreter matches the desired interpreter string, select the interpreter
			if (secondaryInterpreterName.includes(desiredInterpreterString)) {
				this.code.logger.log(
					`Found secondary interpreter: ${secondaryInterpreterName}`
				);
				await secondaryInterpreter.scrollIntoViewIfNeeded();
				await secondaryInterpreter.isVisible();
				await secondaryInterpreter.click();
				return;
			}
		}

		// None of the primary nor secondary interpreters match the desired interpreter
		await this.closeInterpreterDropdown();
		throw new Error(
			`Could not find interpreter ${desiredInterpreterString} for ${desiredInterpreterType}`
		);
	}

	/**
	 * Get the interpreter info for the currently selected interpreter in the dropdown.
	 * @returns The interpreter info for the selected interpreter if found, otherwise undefined.
	 */
	async getSelectedInterpreterInfo(): Promise<InterpreterInfo | undefined> {
		// Get the label for the selected interpreter, e.g. Python 3.10.4 (Pyenv)
		const selectedInterpreterLabel = await this.code.driver
			.getLocator('.top-action-bar-interpreters-manager')
			.getAttribute('aria-label');
		if (!selectedInterpreterLabel) {
			throw new Error('There is no selected interpreter');
		}

		// Open the interpreter manager
		await this.openInterpreterDropdown();

		// Wait for the desired primary interpreter group to load
		const selectedInterpreter = await this.getPrimaryInterpreter(
			selectedInterpreterLabel
		);
		if (!selectedInterpreter) {
			throw new Error(
				`Something went wrong while trying to load the info for ${selectedInterpreterLabel}`
			);
		}

		// Get the interpreter name
		const interpreterName = await this.getInterpreterName(
			selectedInterpreter
		);
		if (!interpreterName) {
			throw new Error(
				`Could not retrieve interpreter name for ${selectedInterpreterLabel}`
			);
		}

		// Get the interpreter path
		const interpreterPath = await this.getInterpreterPath(
			selectedInterpreter
		);
		if (!interpreterPath) {
			throw new Error(
				`Could not retrieve interpreter path for ${selectedInterpreterLabel}`
			);
		}

		// Determine the interpreter type for the selected interpreter
		const interpreterType = getInterpreterType(interpreterName);
		if (!interpreterType) {
			throw new Error(
				`Could not determine interpreter type for ${selectedInterpreterLabel}`
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
	}
}
