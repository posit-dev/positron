/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../code';

// currently a dupe of declaration in ../editor.ts but trying not to modifiy that file
const EDITOR = (filename: string) => `.monaco-editor[data-uri$="${filename}"]`;
const CURRENT_LINE = '.view-overlays .current-line';


export class PositronEditor {

	constructor(private code: Code) { }

	async pressToLine(filename: string, lineNumber: number, press: string): Promise<void> {
		const editor = EDITOR(filename);
		const line = `${editor} .view-lines > .view-line:nth-child(${lineNumber})`;

		const lineLocator = this.code.driver.getLocator(line);

		await lineLocator.press(press);
	}

	async getCurrentLineTop(retries: number = 10): Promise<number> {
		const currentLine = this.code.driver.getLocator(CURRENT_LINE);
		const currentLineParent = currentLine.locator('..');

		const top = await currentLineParent.evaluate((el) => {
			return window.getComputedStyle(el).getPropertyValue('top');
		});

		const topValue = parseInt(top, 10);

		if (isNaN(topValue) && retries > 0) {
			return this.getCurrentLineTop(retries - 1);
		}

		return topValue;
	}

}
