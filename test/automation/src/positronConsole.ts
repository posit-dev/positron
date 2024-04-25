/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from './code';

const CONSOLE_ITEMS = '.console-instance .runtime-items div';

export class PositronConsole {

	constructor(private code: Code) { }

	async logConsoleContents() {

		const consoleTextContainer = await this.code.getElements(CONSOLE_ITEMS, false);
		consoleTextContainer?.forEach(item => console.log(item.textContent));
	}

	async typeToConsole(text: string) {
		await this.code.driver.typeKeys('.lines-content .view-lines div', text);
	}
}
