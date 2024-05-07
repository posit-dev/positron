/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import { Code } from '../code';
import * as os from 'os';

const CONSOLE_ITEMS = '.runtime-items span';
const CONSOLE_INSTANCE = '.console-instance';
const ACTIVE_LINE_NUMBER = '.active-line-number';
const CONSOLE_INPUT = '.console-input';

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

	async sendShiftEnterKeys() {
		await this.code.driver.getKeyboard().press('Shift+Enter');
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


	async sendCodeToConsole(code: string) {
		const activeConsole = await this.getActiveConsole();
		const consoleInput = activeConsole?.locator(CONSOLE_INPUT);
		await this.pasteInMonaco(consoleInput!, code);
	}

	// adapted from:
	// https://github.com/deephaven/web-client-ui/blob/9d905fca86aa8ba4ff53debd1fd12dcc9132299b/tests/utils.ts#L107
	async pasteInMonaco(
		locator: Locator,
		text: string
	): Promise<void> {
		const page = locator.page();
		const isMac = os.platform() === 'darwin';
		const modifier = isMac ? 'Meta' : 'Control';

		// Create a hidden textarea with the contents to paste
		const inputId = await page.evaluate(async evalText => {
			const tempInput = document.createElement('textarea');
			tempInput.id = 'super-secret-temp-input-id';
			tempInput.value = evalText;
			tempInput.style.width = '0';
			tempInput.style.height = '0';
			document.body.appendChild(tempInput);
			tempInput.select();
			return tempInput.id;
		}, text);

		// Copy the contents of the textarea which was selected above
		await page.keyboard.press(`${modifier}+C`);

		// Remove the textarea
		await page.evaluate(id => {
			document.getElementById(id)?.remove();
		}, inputId);

		// Focus monaco
		await locator.click();

		const browserName = locator.page().context().browser()?.browserType().name();
		if (browserName !== 'firefox') {
			// Chromium on mac and webkit on any OS don't seem to paste w/ the keyboard shortcut
			await locator.locator('textarea').evaluate(async (element, evalText) => {
				const clipboardData = new DataTransfer();
				clipboardData.setData('text/plain', evalText);
				const clipboardEvent = new ClipboardEvent('paste', {
					clipboardData,
				});
				element.dispatchEvent(clipboardEvent);
			}, text);
		} else {
			await page.keyboard.press(`${modifier}+V`);
		}

		// if (text.length > 0) {
		// Sanity check the paste happened
		// await expect(locator.locator('textarea')).not.toBeEmpty();
		// }
	}
}
