/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from './code';

const CONSOLE_ITEMS = '.console-instance .runtime-items span';
const CONSOLE_INSTANCES_CONTAINER = '.console-instances-container';

export class PositronConsole {

	constructor(private code: Code) { }

	async getConsoleContents(): Promise<string[]> {

		const consoleTextContainer = this.code.driver.getLocator(CONSOLE_ITEMS);
		const consoleTextItems = await consoleTextContainer.all();

		const consoleContents = await Promise.all(consoleTextItems.map(async (item) => {
			return await item.innerText();
		}));

		return consoleContents;
	}

	async logConsoleContents() {
		const contents = await this.getConsoleContents();
		contents.forEach(line => console.log(line));
	}

	async typeToConsole(text: string) {
		await this.code.driver.typeKeys(CONSOLE_INSTANCES_CONTAINER, text);
	}

	async waitForStarted() {

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

		await this.code.waitForElement('.console-input');

	}
}
