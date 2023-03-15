/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * ZedVar is a simple Zed variable.
 */
class ZedVariable {
	constructor(
		readonly name: string,
		readonly value: string,
		readonly kind: string
	) { }
}

/**
 * ZedEnvironment is a synthetic environment backend for the Zed language containing a set of ZedVariables.
 */
export class ZedEnvironment {

	/**
	 * Emitter that handles outgoing messages to the front end
	 */
	private readonly _onDidEmitData = new vscode.EventEmitter<object>();
	onDidEmitData: vscode.Event<object> = this._onDidEmitData.event;

	/**
	 * A map of variable names to their respective metadata
	 */
	private readonly _vars = new Map<string, ZedVariable>();

	/**
	 * Creates a new ZedEnvironment backend
	 *
	 * @param id The ID of the environment client instance
	 */
	constructor(readonly id: string) {
		// Create a few variables to start with
		this._vars.set('z', new ZedVariable('Z', 'zed1', 'string'));
		this._vars.set('e', new ZedVariable('Z', 'zed2', 'string'));
		this._vars.set('d', new ZedVariable('Z', 'zed3', 'string'));

		setTimeout(() => {
			// List the environment on the first tick after startup. There's no
			// reason we couldn't do this immediately, but waiting a tick simulates the
			// behavior of a "real" language more accuratley.

			this.emitFullList();
		});
	}

	/**
	 * Handles an incoming message from the Positron front end
	 *
	 * @param message The message to handle
	 */
	public handleMessage(message: any) {
		switch (message.msg_type) {

			// A request to refresh the environment by sending a full list to the front end
			case 'refresh':
				this.emitFullList();
				break;
		}
	}

	/**
	 * Emits a full list of variables to the front end
	 */
	private emitFullList() {
		// Create a list of all the variables in the environment
		const vars = Array.from(this._vars.values());

		// Emit the data to the front end
		this._onDidEmitData.fire({
			msg_type: 'list',
			vars: vars
		});
	}
}
