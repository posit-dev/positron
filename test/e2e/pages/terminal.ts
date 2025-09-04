/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';
import { Clipboard } from './clipboard';

const TERMINAL_WRAPPER = '#terminal .terminal-wrapper.active';

export class Terminal {
	terminalTab: Locator;

	constructor(private code: Code, private quickaccess: QuickAccess, private clipboard: Clipboard) {
		this.terminalTab = this.code.driver.page.getByRole('tab', { name: 'Terminal' }).locator('a');
	}

	async sendKeysToTerminal(key: string) {
		await this.code.driver.page.keyboard.press(key);
	}

	async clickTerminalTab() {
		await this.terminalTab.click();
	}

	// Note, this doesn't work for Windows
	async waitForTerminalText(
		terminalText: string,
		options: {
			timeout?: number;
			expectedCount?: number;
			web?: boolean;
		} = {}
	): Promise<string[]> {
		const { timeout = 15000, expectedCount = 1 } = options;

		await expect(async () => {

			// since we are interacting with right click menus, don't poll too fast
			await this.code.wait(2000);

			if (process.platform !== 'darwin') {
				await this.handleContextMenu(this.code.driver.page.locator(TERMINAL_WRAPPER), 'Select All');
			} else {
				await this.code.driver.page.locator(TERMINAL_WRAPPER).click();
				await this.code.driver.page.keyboard.press('Meta+A');
			}

			// wait a little between selection and copy
			await this.code.wait(1000);

			if (process.platform !== 'darwin') {
				await this.handleContextMenu(this.code.driver.page.locator(TERMINAL_WRAPPER), 'Copy');
			} else {
				await this.code.driver.page.keyboard.press('Meta+C');
			}

			const text = await this.clipboard.getClipboardText();

			// clean up regex text
			const safeTerminalText = terminalText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
			// allow case insensitive matches
			const matches = text!.match(new RegExp(safeTerminalText, 'gi'));

			expect(matches?.length).toBe(expectedCount);

			return matches;

		}).toPass({ timeout: timeout });

		return [];
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
		await test.step('Log terminal contents', async () => {
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
		});
	}

	/**
	 * Right clicks and selects a menu item, waiting for menu dismissal.
	 * @param locator Where to right click to get a context menu
	 * @param action Which action to perform on the context menu
	 */
	async handleContextMenu(locator: Locator, action: 'Select All' | 'Copy' | 'Paste') {
		await locator.click({ button: 'right' });
		const menu = this.code.driver.page.locator('.monaco-menu');

		// dismissing dialog can be erratic, allow retries
		for (let i = 0; i < 4; i++) {
			try {
				await menu.locator(`[aria-label="${action}"]`).click();
				await expect(menu).toBeHidden({ timeout: 2000 });
				break;
			} catch {
			}
		}
	}
}
