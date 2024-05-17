/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import { Code } from '../code';
import { QuickAccess } from '../quickaccess';
import { QuickInput } from '../quickinput';

const CONSOLE_ITEMS = '.runtime-items span';
const CONSOLE_INSTANCE = '.console-instance';
const ACTIVE_LINE_NUMBER = '.active-line-number';

export class PositronConsole {

	constructor(private code: Code, private quickaccess: QuickAccess, private quickinput: QuickInput) { }

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
	}

	async logConsoleContents() {
		const contents = await this.getConsoleContents();
		contents.forEach(line => console.log(line));
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

		const activeConsole = await this.getActiveConsole();

		let activeLine = await activeConsole?.locator(ACTIVE_LINE_NUMBER).innerText();

		for (let i = 0; i < 20; i++) {

			if (activeLine === prompt) {
				break;
			} else {
				console.log('Waiting for prompt');
				await this.code.wait(1000);
				activeLine = await activeConsole?.locator(ACTIVE_LINE_NUMBER).innerText();
			}
		}


		// wait up to 20 seconds for the console to show that the interpreter is started
		let consoleContents = await this.getConsoleContents();
		for (let j = 0; j < 20; j++) {
			for (const line of consoleContents) {
				if (line.includes('started')) {
					return;
				} else {
					await this.code.wait(1000);
					consoleContents = await this.getConsoleContents();
				}
			}
		}

		throw new Error('Console never ready to proceed');
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
}
