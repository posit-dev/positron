/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronConsoleInstance } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

export class MainThreadConsole {
	constructor(
		private readonly _console: IPositronConsoleInstance
	) {
	}

	getLanguageId(): string {
		return this._console.runtimeMetadata.languageId;
	}

	pasteText(text: string): void {
		this._console.pasteText(text);
	}
}
