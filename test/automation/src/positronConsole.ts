/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from './code';

const CONSOLE_ITEMS = '.console-instance .runtime-items div';
const CONSOLE_INPUT = '.lines-content .view-lines div';
const CONSOLE_ACTIVE_LINE = '.console-input .monaco-editor .active-line-number';

export class PositronConsole {

	constructor(private code: Code) { }

	async getConsoleContents(): Promise<string[]> {

		const consoleTextContainer = this.code.driver.getLocator(CONSOLE_ITEMS);
		const consoleTextItems = await consoleTextContainer.all();

		const consoleContents: string[] = [];
		consoleTextItems.forEach(async item => {
			const text = await item.innerText();
			const classList = await item.evaluate(el => el.classList);
			if (classList[0] === undefined) {
				consoleContents.push(text);
			}
		});

		return consoleContents;
	}

	async logConsoleContents() {
		const contents = await this.getConsoleContents();
		contents.forEach(line => console.log(line));

	}

	async typeToConsole(text: string) {
		await this.code.driver.typeKeys(CONSOLE_INPUT, text);
	}

	async waitForPrompt() {

		console.log('Waiting for prompt');
		let contents = await this.getConsoleContents();

		// Don't proceed if an interpreter is starting
		for (let i = 0; i < 20; i++) {
			for (let j = 0; j < contents.length; j++) {
				const line = contents[j];
				if (line.includes('starting')) {
					console.log('Interpreter starting');
					await this.code.wait(2000);
					contents = await this.getConsoleContents();
				} else {
					break;
				}
			}
		}

		let activeLine = await this.code.getElement(CONSOLE_ACTIVE_LINE);

		for (let i = 1; i < 20; i++) {
			const activeText = activeLine?.textContent;
			if (activeText === '>>>') {
				break;
			} else {
				console.log('Polling for prompt');
				await this.code.wait(1000);
				activeLine = await this.code.getElement(CONSOLE_ACTIVE_LINE);
			}
		}
	}
}
