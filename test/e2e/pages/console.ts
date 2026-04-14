/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickInput } from './quickInput';
import { HotKeys } from './hotKeys.js';
import { availableRuntimes, SessionRuntimes } from './sessions.js';
import { ContextMenu, MenuItemState } from './dialog-contextMenu.js';

const CONSOLE_INPUT = '.console-input';
export const ACTIVE_CONSOLE_INSTANCE = '.console-instance[style*="z-index: auto"]';
const MAXIMIZE_CONSOLE = '.bottom .codicon-positron-maximize-panel';
const HISTORY_COMPLETION_ITEM = '.history-completion-item';
const EMPTY_CONSOLE = '.positron-console .empty-console';
const INTERRUPT_RUNTIME = 'div.action-bar-button-face .codicon-positron-interrupt-runtime';
const SUGGESTION_LIST = '.suggest-widget .monaco-list-row';
const CONSOLE_LINES = `${ACTIVE_CONSOLE_INSTANCE} div span`;
const ERROR = '.activity-error-message';

/*
 *  Reuseable Positron console functionality for tests to leverage.  Includes the ability to select an interpreter and execute code which
 *  aren't directly console functions, but rather features needed to support console testing.
 */
export class Console {
	restartButton: Locator;
	clearButton: Locator;
	trashButton: Locator;
	activeConsole: Locator;
	suggestionList: Locator;
	addSessionDuplicateButton: Locator;
	addSessionExpandMenuButton: Locator;
	private consoleTab: Locator;
	private error: Locator;

	get emptyConsole() {
		return this.code.driver.page.locator(EMPTY_CONSOLE).getByText('There is no interpreter running');
	}

	constructor(private code: Code, private quickinput: QuickInput, private hotKeys: HotKeys, private contextMenu: ContextMenu) {
		// Standard Console Button Locators
		this.restartButton = this.code.driver.page.getByTestId('restart-session');
		this.clearButton = this.code.driver.page.getByLabel('Clear console');
		this.trashButton = this.code.driver.page.getByTestId('trash-session');

		// `+` Add Session Split Button Locators
		this.addSessionDuplicateButton = this.code.driver.page.getByLabel('Duplicate Active Console Session');
		this.addSessionExpandMenuButton = this.code.driver.page.getByLabel('Quick Launch Session...');

		// Misc
		this.activeConsole = this.code.driver.page.locator(ACTIVE_CONSOLE_INSTANCE);
		this.suggestionList = this.code.driver.page.locator(SUGGESTION_LIST);
		this.consoleTab = this.code.driver.page.getByRole('tab', { name: 'Console', exact: true });
		this.error = this.code.driver.page.locator(ERROR);
	}

	/**
	 * Action: Start a new session via the `+ v` button in the console.
	 *
	 * @param contextMenu
	 * @param runtime provided when option is 'Start New' to specify the runtime for the new session.
	 */
	async clickStartAnotherSessionButton(runtime: SessionRuntimes) {
		await test.step(`Expand \`+\` session button to start new session: ${runtime}`, async () => {

			await this.contextMenu.triggerAndClick({
				menuTrigger: this.addSessionExpandMenuButton,
				menuItemLabel: 'Start Another...'
			});

			await this.quickinput.waitForQuickInputOpened();
			await this.quickinput.type(availableRuntimes[runtime].name);
			await this.code.driver.page.keyboard.press('Enter');
			await this.quickinput.waitForQuickInputClosed();
		});
	}

	/**
	 * Action: Duplicate the active session via the `+` button in the console.
	 */
	async clickDuplicateSessionButton() {
		await test.step(`Click \`+\` to duplicate session`, async () => {
			this.addSessionDuplicateButton.click();
		});
	}

	/**
	 * Action: Create a single file via console
	 */
	async createFile(
		runtime: 'Python' | 'R',
		fileName: string
	) {
		await test.step(`Create file via ${runtime}`, async () => {
			await this.focus();
			const code = runtime === 'Python'
				? `open('${fileName}', 'w').write('hello')`
				: `file.create('${fileName}')`;

			await this.pasteCodeToConsole(code, true);
		});
	}

	/**
	 * Verify: The session context menu contains the expected runtimes.
	 *
	 * @param contextMenu the context menu instance to use for interaction
	 * @param runtimes the runtime names to expect in the context menu
	 */
	async expectSessionContextMenuToContain(runtimes: MenuItemState[]) {
		await test.step('Verify `+` menu contains runtime(s)', async () => {
			await this.contextMenu.triggerAndVerifyMenuItems({
				menuTrigger: this.addSessionExpandMenuButton,
				menuItemStates: runtimes
			});
		});
	}

	/**
	 * Action: Execute code in the console via the quick-input command palette. Waits for the
	 * console to return to the ready prompt after execution by default.
	 *
	 * @param options.timeout - milliseconds to wait for the ready prompt (default: 30000)
	 * @param options.waitForReady - whether to wait for the prompt after execution (default: true)
	 * @param options.maximizeConsole - whether to maximize the console panel afterwards (default: true)
	 * @see waitForReady to wait for the prompt independently
	 * @see pasteCodeToConsole to paste code directly into the console input
	 */
	async executeCode(languageName: 'Python' | 'R', code: string, options?: { timeout?: number; waitForReady?: boolean; maximizeConsole?: boolean }): Promise<void> {
		return test.step(`Execute ${languageName} code in console: ${code}`, async () => {
			const timeout = options?.timeout ?? 30000;
			const waitForReady = options?.waitForReady ?? true;
			const maximizeConsole = options?.maximizeConsole ?? true;

			await expect(async () => {
				// Kind of hacky, but activate console in case focus was previously lost
				await this.focus();
				await this.hotKeys.executeCodeInConsole();
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
			}).toPass();

			if (waitForReady) {
				await this.waitForReady(languageName === 'Python' ? '>>>' : '>', timeout);
			}
			if (maximizeConsole) {
				await this.maximizeConsole();
			}
		});
	}

	/**
	 * Action: Log all visible console text to the test logger. Useful for debugging failures.
	 */
	async logConsoleContents() {
		await test.step('Log console contents', async () => {
			this.code.logger.log('---- START: Console Contents ----');
			const contents = await this.code.driver.page.locator(CONSOLE_LINES).allTextContents();
			contents.forEach(line => this.code.logger.log(line));
			this.code.logger.log('---- END: Console Contents ----');
		});
	}

	/**
	 * Action: Type text into the console input character-by-character, simulating keyboard input.
	 * Use this to trigger autocomplete or test typing behavior.
	 *
	 * @param pressEnter - whether to press Enter after typing (default: false)
	 * @param delay - milliseconds between each keystroke (default: 10)
	 * @see pasteCodeToConsole to insert text instantly without keystroke simulation
	 */
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

	/**
	 * Action: Clear the current console input line (select-all then delete).
	 * Does not affect previously executed output in the console history.
	 *
	 * @see clearButton to clear the entire console output history
	 */
	async clearInput() {
		await test.step('Clear console input', async () => {
			await this.focus();
			await this.hotKeys.selectAll();
			await this.code.driver.page.keyboard.press('Backspace');
		});
	}

	/**
	 * Action: Press Enter in the console to submit the current input line.
	 */
	async sendEnterKey() {
		await test.step('Send Enter key to console', async () => {
			await this.focus();
			await this.code.driver.page.waitForTimeout(500);
			await this.code.driver.page.keyboard.press('Enter');
		});
	}

	/**
	 * Action: Wait for the console to display the language prompt, indicating the runtime is
	 * idle and ready for input. Use `'>>>'` for Python and `'>'` for R.
	 *
	 * @see waitForReadyAndStarted to also confirm a "started" message appeared
	 * @see waitForReadyAndRestarted to also confirm a "restarted" message appeared
	 */
	async waitForReady(prompt: string, timeout = 30000): Promise<void> {
		const activeLine = this.code.driver.page.locator(`${ACTIVE_CONSOLE_INSTANCE} .active-line-number`);
		await expect(activeLine).toHaveText(prompt, { timeout });
	}

	/**
	 * Action: Wait for the console to show the ready prompt AND for a "started" message to
	 * appear in the output. Use after launching a new session.
	 *
	 * @param expectedCount - number of "started" occurrences to wait for (default: 1)
	 * @see waitForReady for prompt-only readiness
	 * @see waitForReadyAndRestarted to wait for a "restarted" message instead
	 */
	async waitForReadyAndStarted(prompt: string, timeout = 30000, expectedCount = 1): Promise<void> {
		await test.step('Wait for console to be ready and started', async () => {
			await this.waitForReady(prompt, timeout);
			await this.waitForConsoleContents('started', { timeout, expectedCount });
		});
	}

	/**
	 * Action: Wait for the console to show the ready prompt AND for a "restarted" message to
	 * appear in the output. Use after restarting an existing session.
	 *
	 * @see waitForReady for prompt-only readiness
	 * @see waitForReadyAndStarted to wait for a "started" message instead
	 */
	async waitForReadyAndRestarted(prompt: string, timeout = 30000): Promise<void> {
		await test.step('Wait for console to be ready and restarted', async () => {
			await this.waitForReady(prompt, timeout);
			await this.waitForConsoleContents('restarted', { timeout });
		});
	}

	/**
	 * Action: Double-click a span of text in the console output. Useful for selecting a word or
	 * triggering double-click interactions on console links or output.
	 */
	async doubleClickConsoleText(text: string) {
		await this.code.driver.page.locator(CONSOLE_LINES).getByText(text).dblclick();
	}

	/**
	 * Verify: Wait for specific text or a regex pattern to appear in the console output. Returns
	 * the matching lines as an array of strings once the expected count is reached.
	 *
	 * @param options.timeout - milliseconds to wait (default: 15000)
	 * @param options.expectedCount - number of matching lines to wait for; pass `0` to assert
	 *   that the text does NOT appear within the timeout (default: 1)
	 * @param options.exact - whether to require an exact text match (default: false)
	 * @see waitForCurrentConsoleLineContents to check only the active input line
	 */
	async waitForConsoleContents(
		consoleTextOrRegex: string | RegExp,
		options: {
			timeout?: number;
			expectedCount?: number;
			exact?: boolean;
		} = {}
	): Promise<string[]> {
		return await test.step(`Verify console contains: ${consoleTextOrRegex}`, async () => {
			const { timeout = 15000, expectedCount = 1, exact = false } = options;

			if (expectedCount === 0) {
				const startTime = Date.now();
				while (Date.now() - startTime < timeout) {
					const errorMessage = `Expected text "${consoleTextOrRegex}" to not appear, but it did.`;

					try {
						const matchingLines = this.code.driver.page.locator(CONSOLE_LINES).getByText(consoleTextOrRegex);
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
			const matchingLines = this.code.driver.page.locator(CONSOLE_LINES).getByText(consoleTextOrRegex, { exact });

			await expect(matchingLines).toHaveCount(expectedCount, { timeout });
			return expectedCount ? matchingLines.allTextContents() : [];
		});
	}


	/**
	 * Verify: Wait for the active console input line to contain the expected text. Returns the
	 * full text content of the line once matched.
	 *
	 * @see waitForConsoleContents to check anywhere in the console output
	 */
	async waitForCurrentConsoleLineContents(expectedText: string, timeout = 30000): Promise<string> {
		const locator = this.code.driver.page.locator(`${ACTIVE_CONSOLE_INSTANCE} .view-line`);
		await expect(locator).toContainText(expectedText, { timeout });
		return await locator.textContent() ?? '';
	}

	/**
	 * Action: Wait for the currently running console execution to finish by polling until the
	 * "Interrupt execution" button is no longer visible.
	 *
	 * @see waitForExecutionComplete which checks the interrupt runtime icon directly
	 */
	async waitForConsoleExecution({ timeout = 20000 }: { timeout?: number } = {}): Promise<void> {
		await expect(this.code.driver.page.getByLabel('Interrupt execution')).not.toBeVisible({ timeout });
	}

	/**
	 * Verify: Wait for history completion items to appear in the console, filtered to those
	 * containing `expectedText`. Returns all history item text contents once the count is met.
	 *
	 * @param count - number of matching history items to wait for (default: 1)
	 */
	async waitForHistoryContents(expectedText: string, count = 1, timeout = 30000): Promise<string[]> {
		const historyItem = this.code.driver.page.locator(HISTORY_COMPLETION_ITEM);
		await expect(historyItem.filter({ hasText: expectedText })).toHaveCount(count, { timeout });
		return await historyItem.allTextContents();
	}

	/**
	 * Action: Maximize the console panel by clicking the maximize button in the bottom bar.
	 */
	async maximizeConsole() {
		await this.code.driver.page.locator(MAXIMIZE_CONSOLE).click();
	}

	/**
	 * Action: Send a keyboard interrupt (Ctrl+C) to the active console session via the hotkey.
	 * Does not require the interrupt button to be visible.
	 *
	 * @see interruptExecution to click the "Interrupt execution" toolbar button instead
	 */
	async sendInterrupt() {
		await this.hotKeys.sendInterrupt();
	}

	/**
	 * Action: Paste code into the console input using clipboard injection. Faster and more
	 * reliable than typing for multi-line or long code snippets.
	 *
	 * @param sendEnterKey - whether to press Enter to submit after pasting (default: false)
	 * @see typeToConsole to simulate character-by-character keyboard input instead
	 * @see executeCode to run code via the quick-input command palette
	 */
	async pasteCodeToConsole(code: string, sendEnterKey = false) {
		await test.step(`Paste code to console: ${code}`, async () => {
			const consoleInput = this.activeConsole.locator(CONSOLE_INPUT);
			await this.pasteInMonaco(consoleInput!, code);

			if (sendEnterKey) {
				await expect(this.code.driver.page.getByLabel('Interrupt execution')).not.toBeVisible();
				await this.sendEnterKey();
			}
		});
	}

	/**
	 * Action: Paste text into a Monaco editor element via a synthetic ClipboardEvent. Retries
	 * up to `maxRetries` times if the pasted text is not detected in the element.
	 *
	 * @param locator - the Monaco editor container locator to paste into
	 * @param maxRetries - number of paste attempts before throwing (default: 3)
	 * @see pasteCodeToConsole for the higher-level helper that targets the console input
	 */
	async pasteInMonaco(
		locator: Locator,
		text: string,
		maxRetries = 3
	): Promise<void> {
		const editContext = locator.locator('.native-edit-context');

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			// Attempt paste
			await editContext.evaluate(async (element, evalText) => {
				const clipboardData = new DataTransfer();
				clipboardData.setData('text/plain', evalText);
				const clipboardEvent = new ClipboardEvent('paste', {
					clipboardData,
				});
				element.dispatchEvent(clipboardEvent);
			}, text);

			// Allow time for paste to register
			await locator.page().waitForTimeout(100);

			function normalize(text: string): string {
				return text
					.normalize('NFKC') // Normalize Unicode (optional but good when working with special chars)
					.replace(/\s+/g, '') // Remove all whitespace
					.replace(/\u00a0/g, '') // Remove non-breaking spaces
					.replace(/[^\x20-\x7E]/g, '') // Remove not printable ASCII
					.trim();
			}

			const visibleText = await locator.evaluate(el => el.textContent || '');

			if (normalize(visibleText).includes(normalize(text))) {
				return; // Paste succeeded
			}

			if (attempt < maxRetries) {
				await locator.page().waitForTimeout(100);
			} else {
				throw new Error('Paste failed after multiple retries');
			}
		}
	}



	/**
	 * Action: Get a locator for the last clickable hyperlink in the active console output.
	 * Returns the locator without waiting - use `.click()` on the result to interact.
	 */
	getLastClickableLink() {
		return this.activeConsole.locator('.output-run-hyperlink').last();
	}

	/**
	 * Action: Wait until the runtime interrupt button becomes visible, indicating that code
	 * execution has begun.
	 *
	 * @see waitForExecutionComplete to wait for execution to finish
	 */
	async waitForExecutionStarted(timeout = 30000): Promise<void> {
		await expect(this.code.driver.page.locator(INTERRUPT_RUNTIME)).toBeVisible({ timeout });
	}

	/**
	 * Action: Wait until the runtime interrupt button is hidden, indicating that code execution
	 * has finished.
	 *
	 * @see waitForExecutionStarted to wait for execution to begin
	 * @see waitForConsoleExecution for an equivalent check via the aria-label button
	 */
	async waitForExecutionComplete(timeout = 30000): Promise<void> {
		await expect(this.code.driver.page.locator(INTERRUPT_RUNTIME)).toBeHidden({ timeout });
	}

	/**
	 * Action: Focus the console panel using the keyboard hotkey. Prefer this over
	 * `clickConsoleTab` when focus is all that's needed - it is faster and more reliable.
	 *
	 * @see clickConsoleTab to bring the Console tab to the foreground when it may be hidden
	 */
	async focus() {
		await this.hotKeys.focusConsole();
	}

	/**
	 * Action: Click the Console tab to bring it to the foreground. Includes a retry loop to
	 * handle cases where the click happens before the panel is interactive.
	 *
	 * @see focus to focus the console via hotkey without needing to click the tab
	 */
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

	/**
	 * Action: Click the "Interrupt execution" toolbar button to stop a running script.
	 * The button must be visible (i.e., code must currently be executing).
	 *
	 * @see sendInterrupt to interrupt via keyboard shortcut without requiring button visibility
	 */
	async interruptExecution() {
		await this.code.driver.page.getByLabel('Interrupt execution').click();
	}

	/**
	 * Verify: Assert that the autocomplete suggestion list contains exactly `count` items.
	 *
	 * @see expectSuggestionListToContain to assert a specific item is present by label
	 */
	async expectSuggestionListCount(count: number): Promise<void> {
		await test.step(`Expect console suggestion list count to be ${count}`, async () => {
			await expect(this.suggestionList).toHaveCount(count, { timeout: 15000 });
		});
	}

	/**
	 * Verify: Assert that the autocomplete suggestion list contains an item matching `label`.
	 *
	 * @see expectSuggestionListCount to assert the total number of suggestions
	 */
	async expectSuggestionListToContain(label: string): Promise<void> {
		await test.step(`Expect console suggestion list to contain: ${label}`, async () => {
			await this.code.driver.page.locator('.suggest-widget').getByLabel(label).isVisible();
		});
	}

	/**
	 * Verify: Assert that an error message matching `error` is visible in the console output.
	 *
	 * @see waitForConsoleContents to wait for arbitrary text (not just errors) in output
	 */
	async expectConsoleToContainError(error: string): Promise<void> {
		await test.step(`Expect console to contain error: ${error}`, async () => {
			await expect(this.error).toContainText(error);
		});
	}
}
