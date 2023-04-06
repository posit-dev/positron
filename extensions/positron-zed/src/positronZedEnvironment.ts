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
	// Zed variables do not currently support truncation.
	public readonly is_truncated: boolean = false;
	public readonly display_type;
	public readonly type_info;
	public readonly has_children;
	public readonly access_key;

	constructor(
		readonly display_name: string,
		readonly display_value: string,
		readonly kind: string,
		readonly length: number,
		readonly size: number,
		readonly children: ZedVariable[] = []) {

		// Set the access key to the variable's name
		this.access_key = display_name;

		// The type name is the language-specific name for the variable's type.
		// In Zed, the variable classes are named things like ZedNUMBER,
		// ZedSTRING, etc.
		this.display_type = `Zed${kind.toUpperCase()}`;

		// Extra information about the type
		this.type_info = `'${this.display_type} (${this.kind}), ${this.size} bytes'`;

		// The Zed language has a sample type named 'blob' that has its own Zed
		// type, ZedBLOB, but is represented as a 'vector' in the environment.
		if (this.kind === 'blob') {
			this.kind = 'vector';
		}

		// The has_children property is true if the variable has children.
		this.has_children = children.length > 0;
	}
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
	 * A counter used to generate unique variable names
	 */
	private _varCounter = 1;

	/**
	 * The maximum number of variables to return when listing the environment. This is
	 * configurable using the `env max` Zed command.
	 */
	private _maxVarDisplay = 1024;

	/**
	 * Creates a new ZedEnvironment backend
	 *
	 * @param id The ID of the environment client instance
	 */
	constructor(readonly id: string,
		private readonly zedVersion: string) {
		// Create a few variables to start with
		this._vars.set('z', new ZedVariable('z', 'zed1', 'string', 4, 4));
		this._vars.set('e', new ZedVariable('e', 'zed2', 'string', 4, 4));
		this._vars.set('d', new ZedVariable('d', 'zed3', 'string', 4, 4));

		// Create a Zed Version variable
		this._vars.set('ZED_VERSION', new ZedVariable('ZED_VERSION',
			this.zedVersion,
			'string',
			this.zedVersion.length,
			this.zedVersion.length));

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

			// A request to delete a set of variables
			case 'delete':
				this.deleteVars(message.names);
				break;

			// A request to inspect a variable
			case 'inspect':
				this.inspectVar(message.path);
				break;

			// A request to format a variable as a string suitable for placing on the clipboard
			case 'clipboard_format':
				this.formatVariable(message.format, message.path);
				break;

		}
	}

	/**
	 * Defines a number of variables at once.
	 *
	 * @param count The number of variables to define
	 * @param kind The kind of variable to define; if not specified, a random kind will be chosen
	 */
	public defineVars(count: number, kind: string) {

		// Generate a list of variables
		const newVars = this.generateVars(count, kind);
		for (const newVar of newVars) {
			this._vars.set(newVar.display_name, newVar);
		}

		// Emit the new variables to the front end
		this.emitUpdate(newVars);
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

		// Update the variables
		const updated = [];
		const randomKeys = this.selectRandomKeys(count);
		for (const key of randomKeys) {
			const oldVar = this._vars.get(key)!;
			let value = '';
			let size = 0;
			let children: ZedVariable[] = [];
			// Create a random value for the variable
			if (oldVar.kind === 'string') {
				// Strings: replace 5 random characters with a hexadecimal digit
				const chars = oldVar.display_value.split('');
				for (let i = 0; i < 5; i++) {
					const randomIndex = Math.floor(Math.random() * chars.length);
					chars[randomIndex] = Math.floor(Math.random() * 16).toString(16);
				}
				value = chars.join('');
				size = value.length;
			} else if (oldVar.kind === 'number') {
				// Numbers: just use a new random number
				value = Math.random().toString();
				size = 4;
			} else if (oldVar.kind === 'vector') {
				if (oldVar.display_value.startsWith('blob')) {
					// Blobs are basically huge vectors. Randomly double or halve the size.
					if (Math.random() < 0.5) {
						size = oldVar.size * 2;
						value = `blob(${size} bytes)`;
					} else {
						size = Math.floor(oldVar.size / 2);
						value = `blob(${size} bytes)`;
					}
				} else {
					// Vectors: replace 2 random bytes with new random bytes and add an extra byte
					// at the end
					const bytes = oldVar.display_value.split(',').map((x) => parseInt(x, 10));
					for (let i = 0; i < 2; i++) {
						const randomIndex = Math.floor(Math.random() * bytes.length);
						bytes[randomIndex] = Math.floor(Math.random() * 256);
					}
					bytes.push(Math.floor(Math.random() * 256));
					value = bytes.join(', ');
					size = bytes.length;
				}
			} else if (oldVar.kind === 'list') {
				// Lists: Add a new random element to the end
				oldVar.children.push(this.generateVars(1, 'random')[0]);
				children = oldVar.children;
				value = `list(${children.length} elements)`;
				size = children.length;
			} else {
				// Everything else: reverse the value
				value = oldVar.display_value.split('').reverse().join('');
				size = value.length;
			}

			const newVar = new ZedVariable(oldVar.display_name, value, oldVar.kind,
				value.length, size, children);
			this._vars.set(key, newVar);

			// Add the variable to the list of updated variables
			updated.push(newVar);
		}

		// Emit the updated variables to the front end
		this.emitUpdate(updated);

		return count;
	}

	/**
	 *
	 * @param count The number of variables to remove
	 * @returns The number of variables that were removed
	 */
	public removeVars(count: number): number {
		// We can't remove more variables than we have, so clamp the count to
		// the number of variables in the environment.
		if (count > this._vars.size) {
			count = this._vars.size;
		}

		// Remove the variables
		const keys = this.selectRandomKeys(count);
		for (const key of keys) {
			this._vars.delete(key);
		}

		// Emit the removed variables to the front end
		this.emitUpdate(undefined, keys);

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
	 * Deletes the variables with the given names from the environment
	 */
	public deleteVars(names: string[]) {
		const removed = [];
		const unknown = [];

		// Ensure we got some variable names
		if (names.length === 0) {
			this._onDidEmitData.fire({
				msg_type: 'error',
				message: `No variable names selected for deletion`
			});
			return;
		}

		// Clear the variables one by one
		for (const name of names) {
			if (this._vars.has(name)) {
				// Looks like we have this variable, so remove it
				removed.push(name);
				this._vars.delete(name);
			} else {
				// We don't have this variable, so add it to the list of unknown variables
				unknown.push(name);
			}
		}

		// If we failed to find any of the variables, emit an error to the client
		if (unknown.length > 0) {
			this._onDidEmitData.fire({
				msg_type: 'error',
				message: `Unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`
			});
		}

		// Refresh the client view. We don't need to do this if we didn't remove
		// any variables, but note that it's possible to have removed some
		// variables and failed to find others; in this case the client will get
		// an error "reply" to the delete request, but the variables that were
		// successfully removed will still be removed from the client view using
		// the "update" message.
		if (removed.length > 0) {
			this.emitUpdate([], removed);
		}
	}

	/**
	 * Sets the maximum number of variables to display in the client
	 *
	 * @param maxVarDisplay The maximum number of variables to display in the client
	 */
	public setMaxVarDisplay(maxVarDisplay: number) {
		// Set the new maximum
		this._maxVarDisplay = maxVarDisplay;

		// Refresh the client view so the new maximum is applied
		this.emitFullList();
	}

	/**
	 * Emits a full list of variables to the front end
	 */
	private emitFullList() {
		// Create a list of all the variables in the environment
		const vars = Array.from(this._vars.values());

		// Clamp the number of variables we are about to return to the maximum
		// number of variables to display
		const length = vars.length;
		if (vars.length > this._maxVarDisplay) {
			vars.length = this._maxVarDisplay;
		}

		// Emit the data to the front end
		this._onDidEmitData.fire({
			msg_type: 'list',
			variables: vars,
			length
		});
	}

	/**
	 * Formats a variable for the clipboard and emits the result to the front end
	 *
	 * @param format The format to use for the variable, as a MIME type (e.g. "text/plain")
	 * @param path The path to the variable to format
	 */
	private formatVariable(format: string, path: string[]) {
		const v = this.findVar(path);
		if (v) {
			// Emit the data to the front end
			this._onDidEmitData.fire({
				msg_type: 'formatted_variable',
				format,
				content: `"${v.display_value}" (${format})`
			});
		} else {
			// We didn't find the variable, so emit an error
			this._onDidEmitData.fire({
				msg_type: 'error',
				error: `Can't format for clipboard; variable not found: ${path.join('.')}`
			});
		}
	}

	/**
	 * Emits an update to the front end
	 *
	 * @param assigned The variables that were added or changed
	 * @param removed The variables that were removed
	 */
	private emitUpdate(assigned?: Array<ZedVariable>, removed?: Array<string>) {
		this._onDidEmitData.fire({
			msg_type: 'update',
			assigned: assigned || [],
			removed: removed || []
		});
	}

	/**
	 * Finds a variable at a given path
	 */
	private findVar(path: string[]): ZedVariable | undefined {
		let v: ZedVariable | undefined = undefined;
		for (const p of path) {
			if (v === undefined) {
				// We're at the root of the variable tree; get the named variable
				v = this._vars.get(p);
			} else {
				// We're in the middle of the variable tree; get the named child
				v = v.children.find(c => c.display_name === p);
			}

			if (v === undefined) {
				break;
			}
		}

		return v;
	}

	/**
	 * Performs the inspection of a variable
	 */
	private inspectVar(path: string[]) {
		const v = this.findVar(path);
		if (v) {
			// Clamp the number of children to the maximum number of
			// children to display
			const children = v.children.length > this._maxVarDisplay ?
				v.children.slice(0, this._maxVarDisplay) : v.children;

			// Emit the data to the front end
			this._onDidEmitData.fire({
				msg_type: 'details',
				children,
				length: v.children.length
			});
		} else {
			// We didn't find the variable, so emit an error
			this._onDidEmitData.fire({
				msg_type: 'error',
				error: `Can't inspect; variable not found: ${path.join('.')}`
			});
		}
	}

	/**
	 * Selects random variable name keys on which to perform some action
	 *
	 * @param count The number of keys to select
	 * @returns An array of keys representing the names of the selected variables
	 */
	private selectRandomKeys(count: number): Array<string> {
		// Make a list of variables; we randomly select variables from the
		// environment until we have the desired number.
		const keys = Array.from(this._vars.keys());
		const randomKeys = [];
		for (let i = 0; i < count; i++) {
			const randomIndex = Math.floor(Math.random() * keys.length);
			randomKeys.push(keys[randomIndex]);
			keys.splice(randomIndex, 1);
		}
		return randomKeys;
	}

	private generateVars(count: number, kind: string): Array<ZedVariable> {

		// Get the starting index for the new variables
		const start = this._varCounter++;

		// Begin building the list of new variables to send
		const added = [];

		for (let i = 0; i < count; i++) {
			let kindToUse = kind;
			if (!kind || kind === 'random') {
				// Random: pick a random kind
				kindToUse = ['string', 'number', 'vector', 'blob', 'list'][Math.floor(Math.random() * 5)];
			}

			const name = `${kindToUse}${start + i}`;
			let value = '';
			let children: ZedVariable[] = [];

			// Create a random value for the variable
			let size = 0;
			if (kindToUse === 'string') {
				// Strings: use a random UUID
				value = randomUUID();
				size = value.length;
			} else if (kindToUse === 'number') {
				// Numbers: use a random number
				value = Math.random().toString();
				size = 4;
			} else if (kindToUse === 'vector') {
				// Vectors: Generate 5 random bytes
				const bytes = [];
				for (let i = 0; i < 5; i++) {
					bytes.push(Math.floor(Math.random() * 256));
				}
				value = bytes.join(', ');
				size = 5;
			} else if (kindToUse === 'blob') {
				// Blobs: Use a random size
				size = Math.floor(Math.random() * 1024 * 1024);
				value = `blob(${size} bytes)`;
			} else if (kindToUse === 'list') {
				// Lists: Have 1 - 3 elements of random types, generated recursively
				const numElements = Math.floor(Math.random() * 3) + 1;
				children = this.generateVars(numElements, 'random');
				value = `list(${numElements} elements)`;
				size = numElements;
			} else {
				// Everything else: use the counter
				value = `value${start + i}`;
				size = value.length;
			}
			const newZedVar = new ZedVariable(name, value, kindToUse, value.length, size, children);
			added.push(newZedVar);
		}
		return added;
	}
}
