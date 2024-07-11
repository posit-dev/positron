/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import { Code } from '../code';
import { QuickAccess } from '../quickaccess';
import { QuickInput } from '../quickinput';
import { InterpreterType } from './positronStartInterpreter';
import { PositronBaseElement } from './positronBaseElement';
import { IElement } from '../driver';


const CONSOLE_INPUT = '.console-input';
const ACTIVE_CONSOLE_INSTANCE = '.console-instance[style*="z-index: auto"]';
const MAXIMIZE_CONSOLE = '.bottom .codicon-positron-maximize-panel';
const CONSOLE_BAR_POWER_BUTTON = 'div.action-bar-button-icon.codicon.codicon-positron-power-button-thin';
const CONSOLE_BAR_RESTART_BUTTON = 'div.action-bar-button-icon.codicon.codicon-positron-restart-runtime-thin';
const CONSOLE_RESTART_BUTTON = 'button.monaco-text-button.runtime-restart-button';
const CONSOLE_BAR_CLEAR_BUTTON = 'div.action-bar-button-icon.codicon.codicon-clear-all';

export interface InterpreterInfo {
	type: InterpreterType;
	version: string;
	path: string;
	source?: string;
}

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

	constructor(private code: Code, private quickaccess: QuickAccess, private quickinput: QuickInput) {
		this.barPowerButton = new PositronBaseElement(CONSOLE_BAR_POWER_BUTTON, this.code);
		this.barRestartButton = new PositronBaseElement(CONSOLE_BAR_RESTART_BUTTON, this.code);
		this.barClearButton = new PositronBaseElement(CONSOLE_BAR_CLEAR_BUTTON, this.code);
		this.consoleRestartButton = new PositronBaseElement(CONSOLE_RESTART_BUTTON, this.code);
	}

	async selectInterpreter(desiredInterpreterType: InterpreterType, desiredInterpreterString: string): Promise<IElement | undefined> {
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

	async selectAndGetInterpreter(desiredInterpreterType: InterpreterType, desiredInterpreterString: string): Promise<InterpreterInfo | undefined> {
		const interpreterElem = await this.selectInterpreter(desiredInterpreterType, desiredInterpreterString);

		if (interpreterElem) {
			const rawInfo = interpreterElem.attributes['aria-label'].split(',');
			const hasSource = rawInfo.length > 2;
			return {
				type: desiredInterpreterType,
				version: rawInfo[0].trim(),
				path: rawInfo[1].trim(),
				source: hasSource ? rawInfo[2].trim() : ''
			};
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

	async sendEnterKey() {
		await this.activeConsole.click();
		await this.code.driver.getKeyboard().press('Enter');
	}

	async waitForReady(prompt: string) {
		// Wait for the prompt to show up.
		await this.code.waitForTextContent(`${ACTIVE_CONSOLE_INSTANCE} .active-line-number`, prompt);

		// Wait for the interpreter to start.
		await this.waitForConsoleContents((contents) => contents.some((line) => line.includes('started')));
	}

	async waitForConsoleContents(accept?: (contents: string[]) => boolean) {
		const elements = await this.code.waitForElements(`${ACTIVE_CONSOLE_INSTANCE} .runtime-items span`,
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
}
