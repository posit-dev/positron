/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import { Code } from '../code';
import { QuickAccess } from '../quickaccess';
import { QuickInput } from '../quickinput';
import { InterpreterInfo, InterpreterType } from './utils/positronInterpreterInfo';
import { PositronBaseElement } from './positronBaseElement';
import { IElement } from '../driver';


const CONSOLE_INPUT = '.console-input';
const ACTIVE_CONSOLE_INSTANCE = '.console-instance[style*="z-index: auto"]';
const MAXIMIZE_CONSOLE = '.bottom .codicon-positron-maximize-panel';
const CONSOLE_BAR_POWER_BUTTON = 'div.action-bar-button-icon.codicon.codicon-positron-power-button-thin';
const CONSOLE_BAR_RESTART_BUTTON = 'div.action-bar-button-icon.codicon.codicon-positron-restart-runtime-thin';
const CONSOLE_RESTART_BUTTON = 'button.monaco-text-button.runtime-restart-button';
const CONSOLE_BAR_CLEAR_BUTTON = 'div.action-bar-button-icon.codicon.codicon-clear-all';
const HISTORY_COMPLETION_ITEM = '.history-completion-item';
const EMPTY_CONSOLE = '.positron-console .empty-console';
const INTERRUPT_RUNTIME = 'div.action-bar-button-face .codicon-positron-interrupt-runtime';

/*
 *  Reuseable Positron console functionality for tests to leverage.  Includes the ability to select an interpreter and execute code which
 *  aren't directly console functions, but rather features needed to support console testing.
 */
export class PositronConsole {
	barPowerButton: PositronBaseElement;
	barRestartButton: PositronBaseElement;
	barClearButton: PositronBaseElement;
	consoleRestartButton: PositronBaseElement;

	activeConsole = this.code.driver.getLocator(ACTIVE_CONSOLE_INSTANCE);
	emptyConsole = this.code.driver.getLocator(EMPTY_CONSOLE).getByText('There is no interpreter running');

	constructor(private code: Code, private quickaccess: QuickAccess, private quickinput: QuickInput) {
		this.barPowerButton = new PositronBaseElement(CONSOLE_BAR_POWER_BUTTON, this.code);
		this.barRestartButton = new PositronBaseElement(CONSOLE_BAR_RESTART_BUTTON, this.code);
		this.barClearButton = new PositronBaseElement(CONSOLE_BAR_CLEAR_BUTTON, this.code);
		this.consoleRestartButton = new PositronBaseElement(CONSOLE_RESTART_BUTTON, this.code);
	}

	async selectInterpreter(desiredInterpreterType: InterpreterType, desiredInterpreterString: string, skipWait: boolean = false): Promise<IElement | undefined> {

		// don't try to start a new interpreter if one is currently starting up
		if (!skipWait) {
			await this.waitForReadyOrNoInterpreter();
		}

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
		const interpreterElem = await this.quickinput.selectQuickInputElementContaining(desiredInterpreterString);
		await this.quickinput.waitForQuickInputClosed();
		return interpreterElem;
	}

	async selectAndGetInterpreter(
		desiredInterpreterType: InterpreterType,
		desiredInterpreter: string
	): Promise<InterpreterInfo | undefined> {
		const interpreterElem = await this.selectInterpreter(
			desiredInterpreterType,
			desiredInterpreter,
			true
		);

		if (interpreterElem) {
			// The aria-label looks something like: Python 3.10.4 64-bit ('3.10.4'), ~/.pyenv/versions/3.10.4/bin/python, Pyenv
			const rawInfo = interpreterElem.attributes['aria-label'].split(',');
			const hasSource = rawInfo.length > 2;
			return {
				type: desiredInterpreterType, // e.g. InterpreterType.Python
				version: rawInfo[0].trim(), // e.g. Python 3.10.4 64-bit ('3.10.4')
				path: rawInfo[1].trim(), // e.g. ~/.pyenv/versions/3.10.4/bin/python
				source: hasSource ? rawInfo[2].trim() : '', // e.g. Pyenv
			} satisfies InterpreterInfo;
		}

		return undefined;
	}

	async executeCode(languageName: string, code: string, prompt: string): Promise<void> {
		await this.quickaccess.runCommand('workbench.action.executeCode.console', { keepOpen: true });

		await this.quickinput.waitForQuickInputOpened();
		await this.quickinput.type(languageName);
		await this.quickinput.waitForQuickInputElements(e => e.length === 1 && e[0] === languageName);
		await this.code.dispatchKeybinding('enter');

		await this.quickinput.waitForQuickInputOpened();
		const unescapedCode = code
			.replace(/\n/g, '\\n')
			.replace(/\r/g, '\\r');
		await this.quickinput.type(unescapedCode);
		await this.code.dispatchKeybinding('enter');
		await this.quickinput.waitForQuickInputClosed();

		// The console will show the prompt after the code is done executing.
		await this.waitForReady(prompt);
		await this.maximizeConsole();
	}

	async logConsoleContents() {
		const contents = await this.waitForConsoleContents();
		contents.forEach(line => this.code.logger.log(line));
	}

	async typeToConsole(text: string) {
		await this.activeConsole.click();
		await this.activeConsole.pressSequentially(text, { delay: 30 });
	}

	async sendKeyboardKey(key: string) {
		await this.code.driver.getKeyboard().press(key);
	}

	async sendEnterKey() {
		await this.activeConsole.click();
		await this.code.driver.getKeyboard().press('Enter');
	}

	async waitForReady(prompt: string, retryCount: number = 500) {
		// Wait for the prompt to show up.
		await this.code.waitForTextContent(`${ACTIVE_CONSOLE_INSTANCE} .active-line-number`, prompt, undefined, retryCount);

		// Wait for the interpreter to start.
		await this.waitForConsoleContents((contents) => contents.some((line) => line.includes('started')));
	}

	/**
	 * Check if the console is ready with Python or R, or if no interpreter is running.
	 * @param retryCount The number of times to retry waiting for the console to be ready.
	 * @throws An error if the console is not ready after the retry count.
	 */
	async waitForReadyOrNoInterpreter(retryCount: number = 800) {
		for (let i = 0; i < retryCount; i++) {
			// Check if the console is ready with Python.
			try {
				await this.waitForReady('>>>', 5);
				// The console is ready with Python.
				return;
			} catch (error) {
				// Python is not ready. Try the next interpreter.
			}

			// Check if the console is ready with R.
			try {
				await this.waitForReady('>', 5);
				// The console is ready with R.
				return;
			} catch (error) {
				// R is not ready. Try the next interpreter.
			}

			// Check if there is no interpreter running.
			try {
				await this.waitForNoInterpretersRunning(5);
				// The console is ready with no interpreter running.
				return;
			} catch (error) {
				// Text indicating no interpreter is running is not present. Try again.
			}
		}

		// If we reach here, the console is not ready.
		throw new Error('Console is not ready after waiting for R or Python to start');
	}

	async waitForNoInterpretersRunning(retryCount: number = 200) {
		const noInterpreter = await this.code.waitForElement(
			EMPTY_CONSOLE,
			() => true,
			retryCount
		);
		if (noInterpreter) {
			return;
		}
		throw new Error('Console is not ready after waiting for no interpreters running');
	}

	async waitForInterpreterShutdown() {
		await this.waitForConsoleContents((contents) =>
			contents.some((line) => line.includes('shut down successfully'))
		);
	}

	async waitForConsoleContents(accept?: (contents: string[]) => boolean) {
		const elements = await this.code.waitForElements(`${ACTIVE_CONSOLE_INSTANCE} div span`,
			false,
			(elements) => accept ? (!!elements && accept(elements.map(e => e.textContent))) : true);
		return elements.map(e => e.textContent);
	}

	async waitForCurrentConsoleLineContents(accept?: (contents: string) => boolean) {
		const element = await this.code.waitForElement(`${ACTIVE_CONSOLE_INSTANCE} .view-line`,
			(e) => accept ? (!!e && accept(e.textContent)) : true);
		return element.textContent;
	}

	async waitForHistoryContents(accept?: (contents: string[]) => boolean) {
		const elements = await this.code.waitForElements(`${HISTORY_COMPLETION_ITEM}`,
			false,
			(elements) => accept ? (!!elements && accept(elements.map(e => e.textContent))) : true);
		return elements.map(e => e.textContent);
	}

	async maximizeConsole() {
		await this.code.waitAndClick(MAXIMIZE_CONSOLE);
	}

	async pasteCodeToConsole(code: string) {
		const consoleInput = this.activeConsole.locator(CONSOLE_INPUT);
		await this.pasteInMonaco(consoleInput!, code);
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

	async waitForExecutionStarted() {
		await this.code.driver.getLocator(INTERRUPT_RUNTIME).waitFor({ state: 'attached' });
	}

	async waitForExecutionComplete() {
		await this.code.driver.getLocator(INTERRUPT_RUNTIME).waitFor({ state: 'detached' });
	}
}
