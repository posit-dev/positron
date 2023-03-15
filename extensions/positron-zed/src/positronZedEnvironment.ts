/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { randomUUID } from 'crypto';

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
	constructor(readonly id: string,
		private readonly zedVersion: string) {
		// Create a few variables to start with
		this._vars.set('z', new ZedVariable('z', 'zed1', 'string'));
		this._vars.set('e', new ZedVariable('e', 'zed2', 'string'));
		this._vars.set('d', new ZedVariable('d', 'zed3', 'string'));

		// Create a Zed Version variable
		this._vars.set('ZED_VERSION', new ZedVariable('ZED_VERSION', this.zedVersion, 'string'));

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
	 * Defines a number of variables at once.
	 *
	 * @param count The number of variables to define
	 * @param kind The kind of variable to define; defaults to 'string'
	 */
	public defineVars(count: number, kind: string) {
		// Select the kind of variable to define
		const kindToUse = kind || 'string';

		// Get the starting index for the new variables
		const start = this._vars.size + 1;

		// Ensure we don't collide with existing variables
		for (let i = 0; i < count; i++) {
			const name = `zed${start + i}`;
			let value = '';

			// Create a random value for the variable
			if (kindToUse === 'string') {
				// Strings: use a random UUID
				value = randomUUID();
			} else if (kindToUse === 'number') {
				// Numbers: use a random number
				value = Math.random().toString();
			} else {
				// Everything else: use the counter
				value = `value{start + i}`;
			}
			this._vars.set(name, new ZedVariable(name, value, kindToUse));
		}

		// Emit the new variables to the front end
		this.emitFullList();
	}

	/**
	 * Clears all variables from the environment
	 */
	public clearAllVars() {
		// Clear the variables
		this._vars.clear();

		// Refresh the client view
		this.emitFullList();
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
			variables: vars
		});
	}
}
