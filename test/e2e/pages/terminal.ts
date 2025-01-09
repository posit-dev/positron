/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

const TERMINAL_WRAPPER = '#terminal .terminal-wrapper';

export class Terminal {
	terminalTab: Locator;

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.terminalTab = this.code.driver.page.getByRole('tab', { name: 'Terminal' }).locator('a');
	}

	async sendKeysToTerminal(key: string) {
		await this.code.driver.page.keyboard.press(key);
	}

	async clickTerminalTab() {
		await this.terminalTab.click();
	}

	async waitForTerminalText(terminalText: string) {

		const terminalLines = this.code.driver.page.locator(TERMINAL_WRAPPER);
		const matchingLines = terminalLines.filter({ hasText: terminalText });

		await expect(matchingLines).toBeVisible();
	}

	async waitForTerminalLines() {

		await expect(async () => {
			const terminalLines = await this.code.driver.page.locator(TERMINAL_WRAPPER).all();
			expect(terminalLines.length).toBeGreaterThan(0);
		}).toPass();
	}

	async createTerminal(): Promise<void> {
		await this.quickaccess.runCommand('workbench.action.terminal.new');
		await this._waitForTerminal();
	}

	private async _waitForTerminal(): Promise<void> {
		await expect(this.code.driver.page.locator('.terminal.xterm.focus')).toBeVisible();
		await this.waitForTerminalLines();
	}

	async runCommandInTerminal(commandText: string): Promise<void> {
		await this.sendTextToTerminal(commandText);

		await this.code.driver.page.keyboard.press('Enter');
	}

	async sendTextToTerminal(text: string) {
		const consoleInput = this.code.driver.page.locator(TERMINAL_WRAPPER);

		await expect(consoleInput).toBeVisible();

		await consoleInput.evaluate(async (element, evalText) => {

			const xterm = (element as any).xterm as (any | undefined);

			if (xterm) {
				xterm.input(evalText);
			}
		}, text);
	}
}
