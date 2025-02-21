/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * A ZedUi instance; wraps the back end of the Zed frontend comm.
 */
export class ZedUi {
	private _directory = '';

	constructor(readonly id: string) {
	}

	/**
	 * Emits an event to the front end indicating a change in the working directory.
	 *
	 * @param directory The directory to change to
	 * @returns The name of the directory
	 */
	public changeDirectory(directory: string): string {
		if (!directory) {
			// Make up a random directory name if we don't have a truthy one
			let hexDigits = Math.floor(Math.random() * 1679616).toString(16);
			while (hexDigits.length < 6) {
				hexDigits = '0' + hexDigits;
			}
			directory = `/dir/example-${hexDigits}`;
		}

		// Emit the event to the front end
		this._directory = directory;
		this._onDidEmitData.fire({
			jsonrpc: '2.0',
			method: 'working_directory',
			params: {
				directory: directory,
			}
		});

		return directory;
	}

	/**
	 * Mark Zed as busy or idle.
	 *
	 * @param busy Whether to mark Zed as busy (true) or idle (false)
	 */
	public markBusy(busy: boolean) {
		this._onDidEmitData.fire({
			msg_type: 'event',
			name: 'busy',
			data: {
				busy: busy,
			}
		});
	}

	get directory(): string {
		return this._directory;
	}

	/**
	 * Emitter that handles outgoing messages to the front end
	 */
	private readonly _onDidEmitData = new vscode.EventEmitter<object>();
	onDidEmitData: vscode.Event<object> = this._onDidEmitData.event;
}
