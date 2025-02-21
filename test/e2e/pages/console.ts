/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import test, { expect, Locator, Page } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';
import { QuickInput } from './quickInput';
import { InterpreterNew } from '../infra';
import { InterpreterType } from '../infra/fixtures/interpreter';

const CONSOLE_INPUT = '.console-input';
const ACTIVE_CONSOLE_INSTANCE = '.console-instance[style*="z-index: auto"]';
const MAXIMIZE_CONSOLE = '.bottom .codicon-positron-maximize-panel';
const CONSOLE_RESTART_BUTTON = 'button.monaco-text-button.runtime-restart-button';
const HISTORY_COMPLETION_ITEM = '.history-completion-item';
const EMPTY_CONSOLE = '.positron-console .empty-console';
const INTERRUPT_RUNTIME = 'div.action-bar-button-face .codicon-positron-interrupt-runtime';
const SUGGESTION_LIST = '.suggest-widget .monaco-list-row';
const CONSOLE_LINES = `${ACTIVE_CONSOLE_INSTANCE} div span`;
const DESIRED_PYTHON = process.env.POSITRON_PY_VER_SEL;
const DESIRED_R = process.env.POSITRON_R_VER_SEL;

/*
 *  Reuseable Positron console functionality for tests to leverage.  Includes the ability to select an interpreter and execute code which
 *  aren't directly console functions, but rather features needed to support console testing.
 */
export class Console {
	barPowerButton: Locator;
	barRestartButton: Locator;
	barClearButton: Locator;
	consoleRestartButton: Locator;
	activeConsole: Locator;
	suggestionList: Locator;
	session: Session;

	get emptyConsole() {
		return this.code.driver.page.locator(EMPTY_CONSOLE).getByText('There is no interpreter running');
	}

	constructor(private code: Code, private quickaccess: QuickAccess, private quickinput: QuickInput, private interpreter: InterpreterNew) {
		this.barPowerButton = this.code.driver.page.getByLabel('Shutdown console');
		this.barRestartButton = this.code.driver.page.getByLabel('Restart console');
		this.barClearButton = this.code.driver.page.getByLabel('Clear console');
		this.consoleRestartButton = this.code.driver.page.locator(CONSOLE_RESTART_BUTTON);
		this.activeConsole = this.code.driver.page.locator(ACTIVE_CONSOLE_INSTANCE);
		this.suggestionList = this.code.driver.page.locator(SUGGESTION_LIST);
		this.session = new Session(this.code.driver.page, this);
	}

	async selectInterpreter(desiredInterpreterType: InterpreterType, desiredInterpreterString: string, waitForReady: boolean = true): Promise<undefined> {

		// don't try to start a new interpreter if one is currently starting up
		await this.waitForReadyOrNoInterpreter();

		let command: string;
		if (desiredInterpreterType === InterpreterType.Python) {
			command = 'python.setInterpreter';
		} else if (desiredInterpreterType === InterpreterType.R) {
			command = 'r.selectInterpreter';
		} else {
			throw new Error(`Interpreter type ${desiredInterpreterType} not supported`);
		}

		await this.quickaccess.runCommand(command, { keepOpen: true });
		await this.quickinput.waitForQuickInputOpened();
		await this.quickinput.type(desiredInterpreterString);

		// Wait until the desired interpreter string appears in the list and select it.
		// We need to click instead of using 'enter' because the Python select interpreter command
		// may include additional items above the desired interpreter string.
		await this.quickinput.selectQuickInputElementContaining(desiredInterpreterString);
		await this.quickinput.waitForQuickInputClosed();

		// Move mouse to prevent tooltip hover
		await this.code.driver.page.mouse.move(0, 0);

		if (waitForReady) {
			desiredInterpreterType === InterpreterType.Python
				? await this.waitForReadyAndStarted('>>>', 40000)
				: await this.waitForReadyAndStarted('>', 40000);
		}
		return;
	}

	/**
	 * Action: Select an interpreter via the dropdown or quickaccess.
	 * @param options - Configuration options for selecting the interpreter.
	 * @param options.language the programming language interpreter to select.
	 * @param options.version the specific version of the interpreter to select (e.g., "3.10.15").
	 * @param options.triggerMode the method used to trigger the selection: dropdown or quickaccess.
	 * @param options.waitForReady whether to wait for the console to be ready after selecting the interpreter.
	 */
	async selectInterpreterNew(options: {
		language: 'Python' | 'R';
		version?: string;
		triggerMode?: 'dropdown' | 'quickaccess';
		waitForReady?: boolean;
	}): Promise<void> {

		if (!DESIRED_PYTHON || !DESIRED_R) {
			throw new Error('Please set env vars: POSITRON_PY_VER_SEL, POSITRON_R_VER_SEL');
		}

		const { language, version = language === 'Python' ? DESIRED_PYTHON : DESIRED_R, waitForReady = true, triggerMode = 'quickaccess' } = options;

		await test.step(`Select interpreter via ${triggerMode}: ${language} ${version}`, async () => {
			// Don't try to start a new interpreter if one is currently starting up
			await this.waitForReadyOrNoInterpreterNew();

			// Start the interpreter via the dropdown or quickaccess
			const command = language === 'Python' ? 'python.setInterpreter' : 'r.selectInterpreter';
			triggerMode === 'quickaccess'
				? await this.quickaccess.runCommand(command, { keepOpen: true })
				: await this.interpreter.openInterpreterDropdown();

			await this.quickinput.waitForQuickInputOpened();
			await this.quickinput.type(`${language} ${version}`);

			// Wait until the desired interpreter string appears in the list and select it.
			// We need to click instead of using 'enter' because the Python select interpreter command
			// may include additional items above the desired interpreter string.
			await this.quickinput.selectQuickInputElementContaining(`${language} ${version}`);
			await this.quickinput.waitForQuickInputClosed();

			// Move mouse to prevent tooltip hover
			await this.code.driver.page.mouse.move(0, 0);

			if (waitForReady) {
				language === 'Python'
					? await this.waitForReadyAndStarted('>>>', 40000)
					: await this.waitForReadyAndStarted('>', 40000);
			}
		});
	}

	async executeCode(languageName: 'Python' | 'R', code: string): Promise<void> {
		await test.step(`Execute ${languageName} code in console: ${code}`, async () => {

			await expect(async () => {
				// Kind of hacky, but activate console in case focus was previously lost
				await this.activeConsole.click();
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

			// The console will show the prompt after the code is done executing.
			await this.waitForReady(languageName === 'Python' ? '>>>' : '>');
			await this.maximizeConsole();
		});
	}

	async logConsoleContents() {
		// await test.step('Log console contents', async () => {
		this.code.logger.log('---- START: Console Contents ----');
		const contents = await this.code.driver.page.locator(CONSOLE_LINES).allTextContents();
		contents.forEach(line => this.code.logger.log(line));
		this.code.logger.log('---- END: Console Contents ----');
		// });
	}

	async typeToConsole(text: string, pressEnter = false, delay = 10) {
		await test.step(`Type to console: ${text}`, async () => {
			await this.code.driver.page.waitForTimeout(500);
			await this.activeConsole.click();
			await this.code.driver.page.keyboard.type(text, { delay });

			if (pressEnter) {
				await this.code.driver.page.keyboard.press('Enter');
			}
		});
	}

	async sendEnterKey() {
		await this.activeConsole.click();
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

	async waitForInterpretersToFinishLoading() {
		// ensure interpreter(s) containing starting/discovering do not exist in DOM
		await expect(this.code.driver.page.locator('text=/^Starting up|^Starting|^Preparing|^Discovering( \\w+)? interpreters|starting\\.$/i')).toHaveCount(0, { timeout: 80000 });
	}

	/**
	 * Check if the console is ready with Python or R, or if no interpreter is running.
	 * @throws An error if the console is not ready after the retry count.
	 */
	async waitForReadyOrNoInterpreter() {
		const page = this.code.driver.page;

		await this.waitForInterpretersToFinishLoading();

		// ensure we are on Console tab
		await page.getByRole('tab', { name: 'Console', exact: true }).locator('a').click();

		// Move mouse to prevent tooltip hover
		await this.code.driver.page.mouse.move(0, 0);

		// wait for the dropdown to contain R, Python, or No Interpreter.
		const currentInterpreter = await page.locator('.top-action-bar-interpreters-manager').textContent() || '';

		if (currentInterpreter.includes('Python')) {
			await expect(page.getByRole('code').getByText('>>>')).toBeVisible({ timeout: 30000 });
			return;
		} else if (currentInterpreter.includes('R')) {
			await expect(page.getByRole('code').getByText('>')).toBeVisible({ timeout: 30000 });
			return;
		} else if (currentInterpreter.includes('Start Interpreter')) {
			await expect(page.getByText('There is no interpreter')).toBeVisible();
			return;
		}

		// If we reach here, the console is not ready.
		throw new Error('Console is not ready after waiting for R or Python to start');
	}

	/**
	 * Check if the console is ready with Python or R, or if Select Runtime.
	 * @throws An error if the console is not ready after the retry count.
	 */
	async waitForReadyOrNoInterpreterNew() {
		await test.step('Wait for console to be ready or no interpreter', async () => {
			const page = this.code.driver.page;

			await this.waitForInterpretersToFinishLoading();

			// ensure we are on Console tab
			await page.getByRole('tab', { name: 'Console', exact: true }).locator('a').click();

			// Move mouse to prevent tooltip hover
			await this.code.driver.page.mouse.move(0, 0);

			// wait for the dropdown to contain R, Python, or Select Runtime.
			const currentInterpreter = await page.getByRole('button', { name: 'Open Active Runtime Picker' }).textContent() || '';

			if (currentInterpreter.includes('Python')) {
				await expect(page.getByRole('code').getByText('>>>')).toBeVisible({ timeout: 30000 });
				return;
			} else if (currentInterpreter.includes('R') && !currentInterpreter.includes('Choose Runtime')) {
				await expect(page.getByRole('code').getByText('>')).toBeVisible({ timeout: 30000 });
				return;
			} else if (currentInterpreter.includes('Choose Runtime')) {
				await expect(page.getByText('Choose Runtime')).toBeVisible();
				return;
			}

			// If we reach here, the console is not ready.
			throw new Error('Console is not ready after waiting for R or Python to start');
		});
	}

	async waitForInterpreterShutdown() {
		await this.waitForConsoleContents('shut down successfully');
	}

	async doubleClickConsoleText(text: string) {
		await this.code.driver.page.locator(CONSOLE_LINES).getByText(text).dblclick();
	}


	async waitForConsoleContents(
		consoleText: string,
		options: {
			timeout?: number;
			expectedCount?: number;
		} = {}
	): Promise<string[]> {
		const { timeout = 15000, expectedCount = 1 } = options;

		const matchingLines = this.code.driver.page.locator(CONSOLE_LINES).getByText(consoleText);

		await expect(matchingLines).toHaveCount(expectedCount, { timeout });
		return expectedCount ? matchingLines.allTextContents() : [];
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
		text: string
	): Promise<void> {

		await locator.locator('textarea').evaluate(async (element, evalText) => {
			const clipboardData = new DataTransfer();
			clipboardData.setData('text/plain', evalText);
			const clipboardEvent = new ClipboardEvent('paste', {
				clipboardData,
			});
			element.dispatchEvent(clipboardEvent);
		}, text);
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

	async clickConsoleTab() {
		// sometimes the click doesn't seem to work, so adding a retry
		await expect(async () => {
			await this.code.driver.page.locator('.basepanel').getByRole('tab', { name: 'Console', exact: true }).locator('a').click();
			// Move mouse to prevent tooltip hover
			await this.code.driver.page.mouse.move(0, 0);
			await expect(this.code.driver.page.getByRole('tab', { name: 'Console', exact: true })).toHaveClass('action-item checked');
		}).toPass();
	}

	async interruptExecution() {
		await this.code.driver.page.getByLabel('Interrupt execution').click();
	}
}

/**
 * Helper class to manage sessions in the console
 */
class Session {
	activeStatus: (session: Locator) => Locator;
	idleStatus: (session: Locator) => Locator;
	disconnectedStatus: (session: Locator) => Locator;
	metadataButton: Locator;
	metadataDialog: Locator;

	constructor(private page: Page, private console: Console) {
		this.activeStatus = (session: Locator) => session.locator('.codicon-positron-status-active');
		this.idleStatus = (session: Locator) => session.locator('.codicon-positron-status-idle');
		this.disconnectedStatus = (session: Locator) => session.locator('.codicon-positron-status-disconnected');
		this.metadataButton = this.page.getByRole('button', { name: 'Console information' });
		this.metadataDialog = this.page.getByRole('dialog');
	}

	/**
	 * Helper: Get the locator for the session tab
	 * @param session details of the session (language and version)
	 * @returns locator for the session tab
	 */
	getSessionLocator(session: SessionDetails): Locator {
		return this.page.getByRole('tab', { name: new RegExp(`${session.language} ${session.version}`) });
	}

	/**
	 * Helper: Get the status of the session tab
	 * @param session details of the session (language and version)
	 * @returns 'active', 'idle', 'disconnected', or 'unknown'
	 */
	private async getStatus(session: SessionDetails): Promise<'active' | 'idle' | 'disconnected' | 'unknown'> {
		const expectedSession = this.getSessionLocator(session);

		if (await this.activeStatus(expectedSession).isVisible()) { return 'active'; }
		if (await this.idleStatus(expectedSession).isVisible()) { return 'idle'; }
		if (await this.disconnectedStatus(expectedSession).isVisible()) { return 'disconnected'; }
		return 'unknown';
	}

	/**
	 * Verify: Check the status of the session tab
	 * @param session details of the session (language and version)
	 * @param expectedStatus status to check for ('active', 'idle', 'disconnected')
	 */
	async checkStatus(session: SessionDetails, expectedStatus: 'active' | 'idle' | 'disconnected') {
		await test.step(`Verify ${session.language} ${session.version} session status: ${expectedStatus}`, async () => {
			const sessionLocator = this.getSessionLocator(session);
			const statusClass = `.codicon-positron-status-${expectedStatus}`;

			await expect(sessionLocator).toBeVisible();
			await expect(sessionLocator.locator(statusClass)).toBeVisible({ timeout: 30000 });
		});
	}

	/**
	 * Verify: Check the metadata of the session dialog
	 * @param data the expected metadata to verify
	 */
	async checkMetadata(data: SessionDetails & { state: 'active' | 'idle' | 'disconnected' | 'exited' }) {
		await test.step(`Verify ${data.language} ${data.version} metadata`, async () => {

			// Click metadata button for desired session
			const sessionLocator = this.getSessionLocator({ language: data.language, version: data.version });
			await sessionLocator.click();
			await this.metadataButton.click();

			// Verify metadata
			await expect(this.metadataDialog.getByText(`${data.language} ${data.version}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(new RegExp(`Session ID: ${data.language.toLowerCase()}-[a-zA-Z0-9]+`))).toBeVisible();
			await expect(this.metadataDialog.getByText(`State: ${data.state}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Path: [\/~a-zA-Z0-9.]+/)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Source: (Pyenv|System)$/)).toBeVisible();

			// Verify Output Channel
			await this.page.getByRole('button', { name: 'Show Kernel Output Channel' }).click();
			// Todo: https://github.com/posit-dev/positron/issues/6389
			// Todo: remove when menu closes on click as expected
			await this.page.keyboard.press('Escape');
			await expect(this.page.getByRole('tab', { name: 'Output' })).toHaveClass('action-item checked');
			await this.page.keyboard.press('Home');
			await expect(this.page.getByText(`Begin kernel log for session ${data.language} ${data.version}`)).toBeVisible();

			// Todo: https://github.com/posit-dev/positron/issues/6149
			// Todo: Verify Language Pack when implemented
			// Todo: Verify Language Console when implemented

			// Go back to console when done
			await this.console.clickConsoleTab();
		});
	}

	/**
	 * Action: Select session in tab list and start the session
	 * @param session details of the session (language and version)
	 * @param waitForIdle wait for the session to display as "idle" (ready)
	 */
	async start(session: SessionDetails, waitForIdle = true): Promise<void> {
		await test.step(`Start session: ${session.language} ${session.version}`, async () => {
			const sessionLocator = this.getSessionLocator(session);
			await sessionLocator.click();
			await this.page.getByLabel('Start console', { exact: true }).click();

			if (waitForIdle) {
				await this.checkStatus(session, 'idle');
			}
		});
	}

	/**
	 * Action: Restart the session
	 * @param session details of the session (language and version)
	 * @param waitForIdle wait for the session to display as "idle" (ready)
	 */
	async restart(session: SessionDetails, waitForIdle = true): Promise<void> {
		await test.step(`Restart session: ${session.language} ${session.version}`, async () => {
			const sessionLocator = this.getSessionLocator(session);
			await sessionLocator.click();
			await this.page.getByLabel('Restart console', { exact: true }).click();

			if (waitForIdle) {
				await this.checkStatus(session, 'idle');
			}
		});
	}

	/**
	 * Action: Shutdown the session
	 * @param session details of the session (language and version)
	 * @param waitForDisconnected wait for the session to display as disconnected
	 */
	async shutdown(session: SessionDetails, waitForDisconnected = true): Promise<void> {
		await test.step(`Shutdown session: ${session.language} ${session.version}`, async () => {
			const sessionLocator = this.getSessionLocator(session);
			await sessionLocator.click();
			await this.page.getByLabel('Shutdown console', { exact: true }).click();

			if (waitForDisconnected) {
				await this.checkStatus(session, 'disconnected');
			}
		});
	}

	/**
	 * Action: Select the session
	 * @param session details of the session (language and version)
	 */
	async select(session: SessionDetails): Promise<void> {
		await test.step(`Select session: ${session.language} ${session.version}`, async () => {
			const sessionLocator = this.getSessionLocator(session);
			await sessionLocator.click();
		});
	}

	/**
	 * Helper: Ensure the session is started and idle (ready)
	 * @param session details of the session (language and version)
	 */
	async ensureStartedAndIdle(session: SessionDetails): Promise<void> {
		await test.step(`Ensure ${session.language} ${session.version} session is started and idle`, async () => {
			// Start Session if it does not exist
			const sessionExists = await this.getSessionLocator(session).isVisible({ timeout: 30000 });
			if (!sessionExists) {
				await this.console.selectInterpreterNew(session);
			}

			// Ensure session is idle (ready)
			const status = await this.console.session.getStatus(session);
			if (status !== 'idle') {
				await this.console.session.start(session);
			}
		});
	}
}

export type SessionDetails = {
	language: 'Python' | 'R';
	version: string; // e.g. '3.10.15'
};
