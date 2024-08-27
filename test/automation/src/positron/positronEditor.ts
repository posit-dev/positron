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

	/**
	 * This function returns the top value of the style attribute for the editor's current-line div
	 * parent (the current-line div is a child of the div that has the top attribute). It retries up
	 * to 10 times to get the value. Retries are necessary because the value is not always
	 * immediately available (presumably due to the change from one current line to another).
	 * @returns Promise that resolves to top value of the style attribute for the editor's
	 * current-line div parent.
	 */
	async getCurrentLineTop(): Promise<number> {
		let retries = 20;
		let topValue: number = NaN;

		const currentLine = this.code.driver.getLocator(CURRENT_LINE);
		// Note that '..' is used to get the parent of the current-line div
		const currentLineParent = currentLine.locator('..');

		// Note that this retry loop does not sleep.  This is because the
		// test that uses this function needs to run as quickly as possible
		// in order to verify that the editor is not executing code out of order.
		while (retries > 0) {

			const boundingBox = await currentLineParent.boundingBox();
			topValue = boundingBox?.y || NaN;

			if (!isNaN(topValue)) {
				break;
			}

			retries--;
		}

		return topValue;
	}
}
