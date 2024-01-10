/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { MainThreadConsoleServiceShape } from './extHost.positron.protocol';
import { ILogService } from 'vs/platform/log/common/log';

export class ExtHostConsole {

	private _disposed: boolean = false;

	private readonly _value: positron.Console;

	constructor(
		id: string,
		proxy: MainThreadConsoleServiceShape,
		logService: ILogService,
	) {
		// So we can access private fields later on
		const that = this;

		// Implement `Console` interface, scoped in such a way that we can access the `id`,
		// `proxy`, and `logService` at any time without requiring them as arguments
		this._value = Object.freeze({
			pasteText(text: string): void {
				if (that._disposed) {
					logService.warn('Console is closed/disposed.');
					return;
				}
				proxy.$tryPasteText(id, text);
			}
		});
	}

	dispose() {
		this._disposed = true;
	}

	getConsole(): positron.Console {
		return this._value;
	}
}

