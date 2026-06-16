/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';
import { escapeRegExp } from '../utils/strings';

const TERMINAL_WRAPPER = '#terminal .terminal-wrapper.active';

export class Terminal {
	terminalTab: Locator;

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.terminalTab = this.code.driver.currentPage.getByRole('tab', { name: 'Terminal' }).locator('a');
	}

	async sendKeysToTerminal(key: string) {
		await this.code.driver.currentPage.keyboard.press(key);
	}

	async clickTerminalTab() {
		await this.terminalTab.click();
	}

	async waitForTerminalText(
		terminalText: string | RegExp,
		options: {
			timeout?: number;
			expectedCount?: number;
			web?: boolean;
		} = {}
	): Promise<string[]> {
		const { timeout = 15000, expectedCount = 1 } = options;

		let matcher: RegExp;
		if (typeof terminalText === 'string') {
			// treat input as literal string, match case-insensitively
			matcher = new RegExp(escapeRegExp(terminalText), 'gi');
		} else {
			// force 'g' so all matches are counted, not just the first
			const flags = terminalText.flags.includes('g') ? terminalText.flags : terminalText.flags + 'g';
			matcher = new RegExp(terminalText, flags);
		}

		await expect(async () => {
			// With GPU acceleration off, terminal renders as DOM and we can read text directly
			const terminalWrapper = this.code.driver.currentPage.locator(TERMINAL_WRAPPER);
			const text = await terminalWrapper.textContent() || '';

			const matches = text.match(matcher);

			expect(matches?.length).toBe(expectedCount);

			return matches;

		}, 'Wait for terminal text').toPass({ timeout: timeout });

		return [];
	}

	async waitForTerminalLines() {

		await expect(async () => {
			const terminalLines = await this.code.driver.currentPage.locator(TERMINAL_WRAPPER).all();
			expect(terminalLines.length).toBeGreaterThan(0);
		}).toPass();
	}

	async createTerminal(): Promise<void> {
		await this.quickaccess.runCommand('workbench.action.terminal.new');
		await this._waitForTerminal();
	}

	private async _waitForTerminal(): Promise<void> {
		await expect(this.code.driver.currentPage.locator('.terminal.xterm.focus')).toBeVisible();
		await this.waitForTerminalLines();
	}

	async runCommandInTerminal(commandText: string): Promise<void> {
		await this.sendTextToTerminal(commandText);
		await this.code.driver.currentPage.locator(TERMINAL_WRAPPER).click();
		await this.code.driver.currentPage.keyboard.press('Enter');
	}

	async sendTextToTerminal(text: string) {
		const consoleInput = this.code.driver.currentPage.locator(TERMINAL_WRAPPER);

		await expect(consoleInput).toBeVisible();

		await consoleInput.evaluate(async (element, evalText) => {

			const xterm = (element as any).xterm as (any | undefined);

			if (xterm) {
				xterm.input(evalText);
			}
		}, text);
	}

	async logTerminalContents() {
		await test.step('Log terminal contents', async () => {
			const terminalRows = this.code.driver.currentPage.locator('.xterm-rows > div');
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
		});
	}

}
