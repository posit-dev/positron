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

const CONSOLE_ITEMS = '.runtime-items span';
const CONSOLE_INSTANCE = '.console-instance';
const ACTIVE_CONSOLE_INSTANCE = '.console-instance[style*="z-index: auto"]';
const MAXIMIZE_CONSOLE = '.bottom .codicon-positron-maximize-panel';
const CONSOLE_BAR_POWER_BUTTON = 'div.action-bar-button-icon.codicon.codicon-positron-power-button-thin';
const CONSOLE_BAR_RESTART_BUTTON = 'div.action-bar-button-icon.codicon.codicon-positron-restart-runtime-thin';
const CONSOLE_RESTART_BUTTON = 'button.monaco-text-button.runtime-restart-button';
const CONSOLE_BAR_CLEAR_BUTTON = 'div.action-bar-button-icon.codicon.codicon-clear-all';

export class PositronConsole {
	barPowerButton: PositronBaseElement;
	barRestartButton: PositronBaseElement;
	barClearButton: PositronBaseElement;
	consoleRestartButton: PositronBaseElement;

	constructor(private code: Code, private quickaccess: QuickAccess, private quickinput: QuickInput) {
		this.barPowerButton = new PositronBaseElement(CONSOLE_BAR_POWER_BUTTON, this.code);
		this.barRestartButton = new PositronBaseElement(CONSOLE_BAR_RESTART_BUTTON, this.code);
		this.barClearButton = new PositronBaseElement(CONSOLE_BAR_CLEAR_BUTTON, this.code);
		this.consoleRestartButton = new PositronBaseElement(CONSOLE_RESTART_BUTTON, this.code);
	}

	async selectInterpreter(desiredInterpreterType: InterpreterType, desiredInterpreterString: string) {
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
	}

	async getConsoleContents(index?: number): Promise<string[]> {

		const activeConsole = await this.getActiveConsole();

		const consoleTextContainer = activeConsole?.locator(CONSOLE_ITEMS);
		const consoleTextItems = await consoleTextContainer?.all();

		const consoleContents = await Promise.all(consoleTextItems!.map(async (item) => {
			return await item.innerText();
		}));

		if (index) {
			return consoleContents.slice(index);
		}

		return consoleContents;
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
		const activeConsole = await this.getActiveConsole();
		await activeConsole?.click();
		await activeConsole?.pressSequentially(text, { delay: 30 });
	}

	async sendEnterKey() {
		const activeConsole = await this.getActiveConsole();
		await activeConsole?.click();
		await this.code.driver.getKeyboard().press('Enter');
	}

	async getActiveConsole(): Promise<Locator | undefined> {

		for (let i = 0; i < 10; i++) {
			const consoleInstances = this.code.driver.getLocator(CONSOLE_INSTANCE);
			const consoleInstancesCount = await consoleInstances.count();
			for (let j = 0; j < consoleInstancesCount; j++) {
				const consoleInstance = consoleInstances.nth(j);
				const zIndex = await consoleInstance.evaluate((e) => {
					return window.getComputedStyle(e).getPropertyValue('z-index');
				});

				if (zIndex === 'auto') {
					return consoleInstance;
				} else {
					await this.code.wait(1000);
				}

			}
		}
		return undefined;
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

	async waitForEndingConsoleText(text: string) {

		let lastConsoleLine = await this.getConsoleContents(-1);

		for (let i = 0; i < 30; i++) {
			if (lastConsoleLine[0] === text) {
				break;
			} else {
				await this.code.wait(100);
				lastConsoleLine = await this.getConsoleContents(-1);
			}
		}
	}

	async maximizeConsole() {
		await this.code.waitAndClick(MAXIMIZE_CONSOLE);
	}
}
