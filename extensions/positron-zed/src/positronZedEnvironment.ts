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

			// A request to clear the environment
			case 'clear':
				this.clearAllVars();
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

		// Begin building the list of new variables to send
		const added = [];

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
				value = `value${start + i}`;
			}

			const newZedVar = new ZedVariable(name, value, kindToUse);
			added.push(newZedVar);

			this._vars.set(name, newZedVar);
		}

		// Emit the new variables to the front end
		this.emitUpdate(added);
	}

	/**
	 * Updates some number of variables in the environment
	 *
	 * @param count The number of variables to update
	 * @returns The number of variables that were updated
	 */
	public updateVars(count: number): number {
		// We can't update more variables than we have, so clamp the count to
		// the number of variables in the environment.
		if (count > this._vars.size) {
			count = this._vars.size;
		}

		// Make a list of variables to update; we randomly select variables from
		// the environment until we have the desired number of variables to
		// update.
		const keys = Array.from(this._vars.keys());
		const randomKeys = [];
		for (let i = 0; i < count; i++) {
			const randomIndex = Math.floor(Math.random() * keys.length);
			randomKeys.push(keys[randomIndex]);
			keys.splice(randomIndex, 1);
		}

		// Update the variables
		const updated = [];
		for (const key of randomKeys) {
			const oldVar = this._vars.get(key)!;
			let value = '';
			// Create a random value for the variable
			if (oldVar.kind === 'string') {
				// Strings: replace 5 random characters with a hexadecimal digit
				const chars = oldVar.value.split('');
				for (let i = 0; i < 5; i++) {
					const randomIndex = Math.floor(Math.random() * chars.length);
					chars[randomIndex] = Math.floor(Math.random() * 16).toString(16);
				}
				value = chars.join('');
			} else if (oldVar.kind === 'number') {
				// Numbers: just use a new random number
				value = Math.random().toString();
			} else {
				// Everything else: reverse the value
				value = oldVar.value.split('').reverse().join('');
			}

			// Save the new variable's value
			const newVar = new ZedVariable(oldVar.name, value, oldVar.kind);
			this._vars.set(key, newVar);

			// Add the variable to the list of updated variables
			updated.push(newVar);
		}

		// Emit the updated variables to the front end
		this.emitUpdate(updated);

		return count;
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

	private emitUpdate(assigned?: Array<ZedVariable>, removed?: Array<string>) {
		this._onDidEmitData.fire({
			msg_type: 'update',
			assigned: assigned || [],
			removed: removed || []
		});
	}
}
