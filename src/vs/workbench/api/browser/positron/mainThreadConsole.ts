/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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
