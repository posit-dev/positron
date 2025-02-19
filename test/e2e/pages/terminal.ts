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

	async waitForTerminalText(
		terminalText: string,
		options: {
			timeout?: number;
			expectedCount?: number;
		} = {}
	): Promise<string[]> {
		const { timeout = 15000, expectedCount = 1 } = options;

		const matchingLines = this.code.driver.page.locator(TERMINAL_WRAPPER).getByText(terminalText);
		await expect(matchingLines).toHaveCount(expectedCount, { timeout });

		return expectedCount ? matchingLines.allTextContents() : [];
	}


	/**
	 * Verify: Wait for the terminal to contain the expected output.
	 * Note: This leverages the clipboard to read the terminal text. This may be helpful if terminal renders canvas.
	 * @param expectedOutput the expected output to be found in the terminal
	 */
	async waitForTerminalTextViaClipboard(expectedOutput: string) {
		await this.code.driver.page.locator('#terminal').click();
		await this.code.driver.context.grantPermissions(['clipboard-read', 'clipboard-write']);

		await expect(async () => {
			await this.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
			await this.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');

			const clipboardText = await this.code.driver.page.evaluate(() => navigator.clipboard.readText());

			return expect(clipboardText).toContain(expectedOutput);
		}).toPass({ timeout: 15000 });
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

	async logTerminalContents() {
		const terminalRows = this.code.driver.page.locator('.xterm-rows > div');
		const terminalContents = (await terminalRows.evaluateAll((rows) =>
			rows.map((row) => {
				const spans = row.querySelectorAll('span');
				return Array.from(spans)
					.map((span) => span.textContent?.trim() || '')
					.join(' ');
			})
		)).filter((line) => line && line.length > 0)
			.join('\n');

		this.code.logger.log('---- START: Terminal Contents ----');
		this.code.logger.log(terminalContents);
		this.code.logger.log('---- END: Terminal Contents ----');
	}
}
