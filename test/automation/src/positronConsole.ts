/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import { Code } from './code';

const CONSOLE_ITEMS = '.runtime-items span';
const CONSOLE_INSTANCE = '.console-instance';
const ACTIVE_LINE_NUMBER = '.active-line-number';

export class PositronConsole {

	constructor(private code: Code) { }

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

	async logConsoleContents() {
		const contents = await this.getConsoleContents();
		contents.forEach(line => console.log(line));
	}

	async typeToConsole(text: string) {
		const activeConsole = await this.getActiveConsole();

		await activeConsole?.pressSequentially(text);
	}

	async sendEnterKey() {
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

	async waitForStarted(prompt: string) {

		const activeConsole = await this.getActiveConsole();

		let activeLine = await activeConsole?.locator(ACTIVE_LINE_NUMBER).innerText();

		for (let i = 0; i < 20; i++) {

			if (activeLine === prompt) {
				break;
			} else {
				console.log('Waiting for prompt');
				await this.code.wait(1000);
				activeLine = await activeConsole?.locator(ACTIVE_LINE_NUMBER).innerText();
				console.log(activeLine);
			}
		}
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
