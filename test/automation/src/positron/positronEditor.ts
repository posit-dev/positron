/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../code';

// currently a dupe of declaration in ../editor.ts but trying not to modifiy that file
const EDITOR = (filename: string) => `.monaco-editor[data-uri$="${filename}"]`;


export class PositronEditor {

	constructor(private code: Code) { }

	async pressToLine(filename: string, lineNumber: number, press: string): Promise<void> {
		const editor = EDITOR(filename);
		const line = `${editor} .view-lines > .view-line:nth-child(${lineNumber})`;

		const lineLocator = this.code.driver.getLocator(line);

		await lineLocator.press(press);
	}

}
