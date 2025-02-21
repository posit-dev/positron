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
	path: string;    // e.g. /usr/local/bin/python3
	source?: string; // e.g. Pyenv, Global, System, etc
}

export class InterpreterNew {
	private interpreterButton = this.code.driver.page.getByRole('button', { name: 'Open Active Session Picker' })
	private interpreterQuickMenu = this.code.driver.page.getByText(/(Select a Session)|(Start a New Session)/);
	private newSessionQuickOption = this.code.driver.page.getByText(/New Session.../);

	constructor(private code: Code) { }

	// -- Actions --

	/**
	 * Action: Open the interpreter dropdown in the top action bar.
	 */
	async openSessionQuickPickMenu(viewAllRuntimes = true) {
		if (!await this.interpreterQuickMenu.isVisible()) {
			await this.interpreterButton.click();
		}

		if (viewAllRuntimes) {
			await this.newSessionQuickOption.click();
			await expect(this.code.driver.page.getByText(/Start a New Session/)).toBeVisible();
		} else {
			await expect(this.code.driver.page.getByText(/Select a Session/)).toBeVisible();
		}
	}

	/**
	 * Action: Close the interpreter dropdown in the top action bar.
	 */
	async closeSessionQuickPickMenu() {
		if (await this.interpreterQuickMenu.isVisible()) {
			await this.code.driver.page.keyboard.press('Escape');
			await expect(this.interpreterQuickMenu).not.toBeVisible();
		}
	}

	// --- Utils ---

	/**
	 * Util: Get active sessions from the session picker.
	 * @returns The list of active sessions.
	 */
	async getActiveSessions(): Promise<QuickPickSessionInfo[]> {
		await this.openSessionQuickPickMenu(false);
		const allSessions = await this.code.driver.page.locator('.quick-input-list-rows').all();

		// Get the text of all sessions
		const activeSessions = await Promise.all(
			allSessions.map(async element => {
				const runtime = (await element.locator('.quick-input-list-row').nth(0).textContent())?.replace('Currently Selected', '');
				const path = await element.locator('.quick-input-list-row').nth(1).textContent();
				return { name: runtime?.trim() || '', path: path?.trim() || '' };
			})
		);

		// Filter out the one with "New Session..."
		const filteredSessions = activeSessions
			.filter(session => !session.name.includes("New Session..."))

		await this.closeSessionQuickPickMenu();
		return filteredSessions;
	}

	/**
	 * Util: Get the interpreter info for the currently selected interpreter in the dropdown.
	 * @returns The interpreter info for the selected interpreter if found, otherwise undefined.
	 */
	async getSelectedSessionInfo(): Promise<InterpreterInfo> {
		await this.openSessionQuickPickMenu(false);
		const selectedInterpreter = this.code.driver.page.locator('.quick-input-list-entry').filter({ hasText: 'Currently Selected' })

		// Extract the runtime name
		const runtime = await selectedInterpreter.locator('.monaco-icon-label-container .label-name .monaco-highlighted-label').nth(0).textContent();

		// Extract the language, version, and source from runtime name
		const { language, version, source } = await this.parseRuntimeName(runtime);

		// Extract the path
		const path = await selectedInterpreter.locator('.quick-input-list-label-meta .monaco-icon-label-container .label-name .monaco-highlighted-label').nth(0).textContent();

		await this.closeSessionQuickPickMenu();

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
	async verifySessionIsSelected(
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
			const interpreterInfo = await this.getSelectedSessionInfo();
			expect(interpreterInfo.language).toContain(language);
			expect(interpreterInfo.version).toContain(version);
		});
	}
}

export type QuickPickSessionInfo = {
	name: string;
	path: string;
};
