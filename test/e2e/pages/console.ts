/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';
import { QuickInput } from './quickInput';
import { HotKeys } from './hotKeys.js';

const CONSOLE_INPUT = '.console-input';
const ACTIVE_CONSOLE_INSTANCE = '.console-instance[style*="z-index: auto"]';
const MAXIMIZE_CONSOLE = '.bottom .codicon-positron-maximize-panel';
const HISTORY_COMPLETION_ITEM = '.history-completion-item';
const EMPTY_CONSOLE = '.positron-console .empty-console';
const INTERRUPT_RUNTIME = 'div.action-bar-button-face .codicon-positron-interrupt-runtime';
const SUGGESTION_LIST = '.suggest-widget .monaco-list-row';
const CONSOLE_LINES = `${ACTIVE_CONSOLE_INSTANCE} div span`;

/*
 *  Reuseable Positron console functionality for tests to leverage.  Includes the ability to select an interpreter and execute code which
 *  aren't directly console functions, but rather features needed to support console testing.
 */
export class Console {
	restartButton: Locator;
	clearButton: Locator;
	trashButton: Locator;
	newSessionButton: Locator;
	activeConsole: Locator;
	suggestionList: Locator;
	private consoleTab: Locator;

	get emptyConsole() {
		return this.code.driver.page.locator(EMPTY_CONSOLE).getByText('There is no interpreter running');
	}

	constructor(private code: Code, private quickaccess: QuickAccess, private quickinput: QuickInput, private hotKeys: HotKeys) {
		this.restartButton = this.code.driver.page.getByLabel('Restart console');
		this.clearButton = this.code.driver.page.getByLabel('Clear console');
		this.trashButton = this.code.driver.page.getByTestId('trash-session');
		this.newSessionButton = this.code.driver.page.getByRole('toolbar', { name: 'Console actions' }).getByRole('button', { name: 'Start a New Session' });
		this.activeConsole = this.code.driver.page.locator(ACTIVE_CONSOLE_INSTANCE);
		this.suggestionList = this.code.driver.page.locator(SUGGESTION_LIST);
		this.consoleTab = this.code.driver.page.getByRole('tab', { name: 'Console', exact: true });
	}


	async executeCode(languageName: 'Python' | 'R', code: string, options?: { timeout?: number; waitForReady?: boolean; maximizeConsole?: boolean }): Promise<void> {
		return test.step(`Execute ${languageName} code in console: ${code}`, async () => {
			const timeout = options?.timeout ?? 30000;
			const waitForReady = options?.waitForReady ?? true;
			const maximizeConsole = options?.maximizeConsole ?? true;

			await expect(async () => {
				// Kind of hacky, but activate console in case focus was previously lost
				await this.focus();
				await this.quickaccess.runCommand('workbench.action.executeCode.console', { keepOpen: true });

			}).toPass();

			await this.quickinput.waitForQuickInputOpened();
			await this.quickinput.type(languageName);
			await this.quickinput.waitForQuickInputElements(e => e.length === 1 && e[0] === languageName);
			await this.code.driver.page.keyboard.press('Enter');

			await this.quickinput.waitForQuickInputOpened();
			const unescapedCode = code
				.replace(/\n/g, '\\n')
				.replace(/\r/g, '\\r');
			await this.quickinput.type(unescapedCode);
			await this.code.driver.page.keyboard.press('Enter');
			await this.quickinput.waitForQuickInputClosed();

			if (waitForReady) {
				await this.waitForReady(languageName === 'Python' ? '>>>' : '>', timeout);
			}
			if (maximizeConsole) {
				await this.maximizeConsole();
			}
		});
	}

	async logConsoleContents() {
		await test.step('Log console contents', async () => {
			this.code.logger.log('---- START: Console Contents ----');
			const contents = await this.code.driver.page.locator(CONSOLE_LINES).allTextContents();
			contents.forEach(line => this.code.logger.log(line));
			this.code.logger.log('---- END: Console Contents ----');
		});
	}

	async typeToConsole(text: string, pressEnter = false, delay = 10) {
		await test.step(`Type to console: ${text}`, async () => {
			await this.code.driver.page.waitForTimeout(500);
			await this.activeConsole.click();
			await this.code.driver.page.keyboard.type(text, { delay });

			if (pressEnter) {
				await this.code.driver.page.waitForTimeout(1000);
				await this.code.driver.page.keyboard.press('Enter');
			}
		});
	}

	async clearInput() {
		await test.step('Clear console input', async () => {
			await this.focus();
			await this.hotKeys.selectAll();
			await this.code.driver.page.keyboard.press('Backspace');
		});
	}

	async sendEnterKey() {
		await this.focus();
		await this.code.driver.page.waitForTimeout(500);
		await this.code.driver.page.keyboard.press('Enter');
	}

	async waitForReady(prompt: string, timeout = 30000): Promise<void> {
		const activeLine = this.code.driver.page.locator(`${ACTIVE_CONSOLE_INSTANCE} .active-line-number`);
		await expect(activeLine).toHaveText(prompt, { timeout });
	}

	async waitForReadyAndStarted(prompt: string, timeout = 30000): Promise<void> {
		await test.step('Wait for console to be ready and started', async () => {
			await this.waitForReady(prompt, timeout);
			await this.waitForConsoleContents('started', { timeout });
		});
	}

	async waitForReadyAndRestarted(prompt: string, timeout = 30000): Promise<void> {
		await test.step('Wait for console to be ready and restarted', async () => {
			await this.waitForReady(prompt, timeout);
			await this.waitForConsoleContents('restarted', { timeout });
		});
	}

	async doubleClickConsoleText(text: string) {
		await this.code.driver.page.locator(CONSOLE_LINES).getByText(text).dblclick();
	}

	async waitForConsoleContents(
		consoleText: string,
		options: {
			timeout?: number;
			expectedCount?: number;
			exact?: boolean;
		} = {}
	): Promise<string[]> {
		return await test.step(`Verify console contains: ${consoleText}`, async () => {
			const { timeout = 15000, expectedCount = 1, exact = false } = options;

			if (expectedCount === 0) {
				const startTime = Date.now();
				while (Date.now() - startTime < timeout) {
					const errorMessage = `Expected text "${consoleText}" to not appear, but it did.`;

					try {
						const matchingLines = this.code.driver.page.locator(CONSOLE_LINES).getByText(consoleText);
						const count = await matchingLines.count();

						if (count > 0) {
							throw new Error(errorMessage); // Fail the test immediately
						}
					} catch (error) {
						if (error instanceof Error && error.message.includes(errorMessage)) {
							throw error;
						}
					}

					await new Promise(resolve => setTimeout(resolve, 1000));
				}
				return [];
			}

			// Normal case: waiting for `expectedCount` occurrences
			const matchingLines = this.code.driver.page.locator(CONSOLE_LINES).getByText(consoleText, { exact });

			await expect(matchingLines).toHaveCount(expectedCount, { timeout });
			return expectedCount ? matchingLines.allTextContents() : [];
		});
	}


	async waitForCurrentConsoleLineContents(expectedText: string, timeout = 30000): Promise<string> {
		const locator = this.code.driver.page.locator(`${ACTIVE_CONSOLE_INSTANCE} .view-line`);
		await expect(locator).toContainText(expectedText, { timeout });
		return await locator.textContent() ?? '';
	}

	async waitForConsoleExecution({ timeout = 20000 }: { timeout?: number } = {}): Promise<void> {
		await expect(this.code.driver.page.getByLabel('Interrupt execution')).not.toBeVisible({ timeout });
	}

	async waitForHistoryContents(expectedText: string, count = 1, timeout = 30000): Promise<string[]> {
		const historyItem = this.code.driver.page.locator(HISTORY_COMPLETION_ITEM);
		await expect(historyItem.filter({ hasText: expectedText })).toHaveCount(count, { timeout });
		return await historyItem.allTextContents();
	}

	async maximizeConsole() {
		await this.code.driver.page.locator(MAXIMIZE_CONSOLE).click();
	}

	async pasteCodeToConsole(code: string, sendEnterKey = false) {
		const consoleInput = this.activeConsole.locator(CONSOLE_INPUT);
		await this.pasteInMonaco(consoleInput!, code);

		if (sendEnterKey) {
			await expect(this.code.driver.page.getByLabel('Interrupt execution')).not.toBeVisible();
			await this.sendEnterKey();
		}
	}

	async pasteInMonaco(
		locator: Locator,
		text: string,
		maxRetries = 3
	): Promise<void> {
		const textarea = locator.locator('textarea');

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			// Attempt paste
			await textarea.evaluate(async (element, evalText) => {
				const clipboardData = new DataTransfer();
				clipboardData.setData('text/plain', evalText);
				const clipboardEvent = new ClipboardEvent('paste', {
					clipboardData,
				});
				element.dispatchEvent(clipboardEvent);
			}, text);

			// Allow time for paste to register
			await locator.page().waitForTimeout(100);

			// Check if paste succeeded
			const pastedValue = await textarea.evaluate(el => (el as HTMLTextAreaElement).value);

			if (pastedValue.includes(text)) {
				return; // Success
			}

			if (attempt < maxRetries) {
				await locator.page().waitForTimeout(100);
			} else {
				throw new Error('Paste failed after multiple retries');
			}
		}
	}



	getLastClickableLink() {
		return this.activeConsole.locator('.output-run-hyperlink').last();
	}

	async waitForExecutionStarted(timeout = 30000): Promise<void> {
		await expect(this.code.driver.page.locator(INTERRUPT_RUNTIME)).toBeVisible({ timeout });
	}

	async waitForExecutionComplete(timeout = 30000): Promise<void> {
		await expect(this.code.driver.page.locator(INTERRUPT_RUNTIME)).toBeHidden({ timeout });
	}

	async focus() {
		await this.hotKeys.focusConsole();
	}

	async clickConsoleTab() {
		// sometimes the click doesn't work (or happens too fast), so adding a retry
		await expect(async () => {
			const consoleInput = this.code.driver.page.locator('div.console-input').first();

			if (!await consoleInput.isVisible()) {
				await this.consoleTab.click();
			}

			expect(await consoleInput.count()).toBeGreaterThan(0);
		}).toPass({ timeout: 10000 });
	}

	async interruptExecution() {
		await this.code.driver.page.getByLabel('Interrupt execution').click();
	}

	async expectSuggestionListCount(count: number): Promise<void> {
		await test.step(`Expect console suggestion list count to be ${count}`, async () => {
			await expect(this.suggestionList).toHaveCount(count);
		});
	}

	async expectSuggestionListToContain(label: string): Promise<void> {
		await test.step(`Expect console suggestion list to contain: ${label}`, async () => {
			await this.code.driver.page.locator('.suggest-widget').getByLabel(label).isVisible();
		});
	}
}
