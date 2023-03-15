/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * ZedEnvironment is a synthetic environment backend for the Zed language.
 */
export class ZedEnvironment {

	/**
	 * Emitter that handles outgoing messages to the front end
	 */
	private readonly _onDidEmitData = new vscode.EventEmitter<object>();
	onDidEmitData: vscode.Event<object> = this._onDidEmitData.event;

	constructor(readonly id: string) {
	}

	public handleMessage(message: object) {
		// TODO
	}
}
