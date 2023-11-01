/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * A ZedFrontend instance; wraps the back end of the Zed frontend comm.
 */
export class ZedFrontend {
	private _directory = '';

	constructor(readonly id: string) {
	}

	/**
	 * Emits an event to the front end indicating a change in the working directory.
	 *
	 * @param directory The directory to change to
	 */
	public changeDirectory(directory: string): void {
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
			msg_type: 'event',
			name: 'working_directory',
			data: {
				directory: directory,
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
