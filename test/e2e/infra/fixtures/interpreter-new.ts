/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect } from '@playwright/test';
import { Code } from '../code';

const DESIRED_PYTHON = process.env.POSITRON_PY_VER_SEL;
const DESIRED_R = process.env.POSITRON_R_VER_SEL;

export interface InterpreterInfo {
	language: 'Python' | 'R';
	version: string; // e.g. Python 3.12.4 64-bit or Python 3.9.19 64-bit ('3.9.19') or R 4.4.0
	path: string;    // e.g. /usr/local/bin/python3 or ~/.pyenv/versions/3.9.19/bin/python or /Library/Frameworks/R.framework/Versions/4.4-arm64/Resources/bin/R
	source?: string; // e.g. Pyenv, Global, Conda, or System
}

export class InterpreterNew {
	private interpreterDropdown = this.code.driver.page.getByRole('button', { name: 'Open Active Session Picker' })
	private interpreterQuickMenu = this.code.driver.page.getByText(/(Select an Active Runtime)|(Start Another Runtime)/);

	constructor(private code: Code) { }

	// -- Actions --

	/**
	 * Action: Open the interpreter dropdown in the top action bar.
	 */
	async openInterpreterDropdown(viewAllRuntimes = true) {
		if (!await this.interpreterQuickMenu.isVisible()) {
			await this.interpreterDropdown.click();
			//runCommand: workbench.action.language.runtime.openActivePicker
		}

		if (viewAllRuntimes) {
			await this.code.driver.page.getByText(/New Session.../).click();
			await expect(this.code.driver.page.getByText(/Start a New Session/)).toBeVisible();
		} else {
			await expect(this.code.driver.page.getByText(/New Session.../)).toBeVisible();
		}
	}

	/**
	 * Action: Close the interpreter dropdown in the top action bar.
	 */
	async closeInterpreterDropdown() {
		if (await this.interpreterQuickMenu.isVisible()) {
			await this.code.driver.page.keyboard.press('Escape');
			await expect(this.interpreterQuickMenu).not.toBeVisible();
		}
	}

	// --- Utils ---

	/**
	 * Util: Get the interpreter info for the currently selected interpreter in the dropdown.
	 * @returns The interpreter info for the selected interpreter if found, otherwise undefined.
	 */
	async getSelectedInterpreterInfo(): Promise<InterpreterInfo> {
		await this.openInterpreterDropdown(false);
		const selectedInterpreter = this.code.driver.page.locator('.quick-input-list-entry').filter({ hasText: 'Currently Selected' })

		// Extract the runtime name
		const runtime = await selectedInterpreter.locator('.monaco-icon-label-container .label-name .monaco-highlighted-label').nth(0).textContent();

		// Extract the language, version, and source from runtime name
		const { language, version, source } = await this.parseRuntimeName(runtime);

		// Extract the path
		const path = await selectedInterpreter.locator('.quick-input-list-label-meta .monaco-icon-label-container .label-name .monaco-highlighted-label').nth(0).textContent();

		await this.closeInterpreterDropdown();

		return {
			language: language as 'Python' | 'R',
			version,
			source,
			path: path || '',
		}
	}


	// --- Helpers ---

	/**
	 * Helper: Parse the full runtime name into language, version, and source.
	 * @param runtimeName the full runtime name to parse. E.g., "Python 3.10.15 (Pyenv)"
	 * @returns The parsed runtime name. E.g., { language: "Python", version: "3.10.15", source: "Pyenv" }
	 */
	async parseRuntimeName(runtimeName: string | null) {
		if (!runtimeName) {
			throw new Error('No interpreter string provided');
		}

		// Note: Some interpreters may not have a source, so the source is optional
		const match = runtimeName.match(/^(\w+)\s([\d.]+)(?:\s\(([^)]+)\))?$/);
		if (!match) {
			throw new Error(`Invalid interpreter format: ${runtimeName}`);
		}

		return {
			language: match[1],  // e.g., "Python", "R"
			version: match[2],   // e.g., "3.10.15", "4.4.1"
			source: match[3] || undefined    // e.g., "Pyenv", "System"
		};
	}

	// --- Verifications ---

	/**
	 * Verify: the selected interpreter is the expected interpreter.
	 * @param version The descriptive string of the interpreter to verify.
	 */
	async verifyInterpreterIsSelected(
		options: { language?: 'Python' | 'R'; version?: string } = {}
	) {
		if (!DESIRED_PYTHON || !DESIRED_R) {
			throw new Error('Please set env vars: POSITRON_PY_VER_SEL, POSITRON_R_VER_SEL');
		}

		const {
			language = 'Python',
			version = language === 'Python' ? DESIRED_PYTHON : DESIRED_R,
		} = options;
		await test.step(`Verify interpreter is selected: ${language} ${version}`, async () => {
			const interpreterInfo = await this.getSelectedInterpreterInfo();
			expect(interpreterInfo.language).toContain(language);
			expect(interpreterInfo.version).toContain(version);
		});
	}
}
