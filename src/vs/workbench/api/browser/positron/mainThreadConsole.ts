/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';

export class MainThreadConsole {
	constructor(
		private readonly _console: IPositronConsoleInstance
	) {
	}

	pasteText(text: string): void {
		this._console.pasteText(text);
	}
}
