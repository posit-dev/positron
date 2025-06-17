/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { Disposable } from 'vscode';
import { MainThreadConsoleServiceShape } from './extHost.positron.protocol.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * The extension host's view of a console instance
 *
 * Cousin to `MainThreadConsole`
 *
 * Do not add more methods to this class directly. Instead, add them to the
 * `positron.Console` API and implement them in `Object.freeze()` below by
 * calling out to the main thread.
 *
 * `positron.Console` is modeled after the design of `vscode.TextEditor`, which
 * similarly has both `ExtHostTextEditor` and `MainThreadTextEditor`.
 */
export class ExtHostConsole implements Disposable {

	private _disposed: boolean = false;

	private readonly _value: positron.Console;

	constructor(
		sessionId: string,
		proxy: MainThreadConsoleServiceShape,
		logService: ILogService,
	) {
		// So we can access private fields later on
		const that = this;

		// Implement `Console` interface, scoped in such a way that we can access the `sessionId`,
		// `proxy`, and `logService` at any time without requiring them as arguments
		this._value = Object.freeze({
			pasteText(text: string): void {
				if (that._disposed) {
					logService.warn('Console is closed/disposed.');
					return;
				}
				proxy.$tryPasteText(sessionId, text);
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

