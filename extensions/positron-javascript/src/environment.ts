/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Represents a single variable in the Javascript environment, serialized for transmission to the front end
 * Positron's environment pane.
 */
class JavascriptVariable {

	// Fields and default values used by Positron's environment pane
	public readonly is_truncated: boolean = false;
	public readonly type_info: string = '';
	public readonly has_viewer: boolean = false;
	public readonly access_key;
	public readonly kind: string;
	public readonly has_children: boolean = false;
	public readonly display_value: string = '';
	public readonly display_type: string;
	public readonly length: number;
	public readonly size: number = 0;

	/**
	 * Construct a new serialized variable
	 *
	 * @param display_name The display name of the variable
	 * @param value The variable's value
	 */
	constructor(readonly display_name: string, value: any) {

		this.access_key = display_name;
		this.length = 0;
		this.display_type = typeof (value);

		// Attempt to format the value as a string
		try {
			this.display_value = JSON.stringify(value);
		} catch (e) {
			this.display_value = '<unknown>';
		}

		switch (this.display_type) {
			case 'number':
				// Ordinary numbers
				this.kind = 'number';
				break;

			case 'bigint':
				//BigInts
				this.kind = 'number';
				break;

			case 'boolean':
				// True/false values
				this.kind = 'boolean';
				break;

			case 'object':
				// All objects and other types. Including 'null' because of course
				// null is an object in Javascript. Of course it is.
				if (value === null) {
					this.kind = 'empty';
				} else {
					// For other object types, represent them as a collection.
					// Note that this includes arrays, which are also objects.
					this.kind = 'collection';
					this.length = Object.keys(value).length;
					this.has_children = this.length > 0;
				}
				break;

			case 'string':
				// Character strings
				this.kind = 'string';
				this.size = this.display_value.length;
				break;

			case 'undefined':
				// The special 'undefined' value
				this.kind = 'empty';
				break;

			default:
				this.kind = 'other';
		}

		this.has_children = this.kind === 'collection';
	}

}

export class JavascriptEnvironment {

	/**
	 * The currently known set of keys (variable names); used to generate a
	 * list of added and removed variables when scanning for changes.
	 */
	private _keys: Array<string> = [];

	/**
	 * Emitter for environment data; used to send data to the front end
	 */
	private readonly _onDidEmitData = new vscode.EventEmitter<object>();
	onDidEmitData: vscode.Event<object> = this._onDidEmitData.event;

	/**
	 * Creates a new JavascriptEnvironment backend
	 *
	 * @param id The ID of the environment client instance
	 */
	constructor(readonly id: string) {
		// Send the full set of variables to the front end
		setTimeout(() => {
			this.emitFullList();
		});
	}

	/**
	 * Handles an incoming message from the Positron front end
	 *
	 * @param message The message to handle
	 */
	public handleMessage(message_id: string, message: any) {
		switch (message.msg_type) {

			// A request to refresh the environment by sending a full list to the front end
			case 'refresh':
				this.emitFullList();
				break;


			// A request to inspect (expand) a variable
			case 'inspect':
				this.inspectVar(message.path);
				break;

			// A request to format a variable as a string suitable for placing on the clipboard
			case 'clipboard_format':
				// this.formatVariable(message.format, message.path);
				break;

			default:
				// Note that we don't handle `clear` or `delete` since you can't
				// reliably delete variables in Javascript.
				console.log(`Unhandled message type: ${message.msg_type}`);
				break;
		}
	}

	/**
	 * Scan for changes in the global environment and send them to the front end
	 */
	public scanForChanges() {
		// Get the set of keys (variable names) in the global environment
		const keys = Object.keys(global);

		// Filter for any added or removed keys
		// (note: we don't currently handle changes to existing variables)
		const addedKeys = keys.filter((key) => !this._keys.includes(key));
		const removedKeys = this._keys.filter((key) => !keys.includes(key));

		// Serialize the content of any new variables
		const added = Object.entries(global)
			.filter((entry) => addedKeys.includes(entry[0]))
			.map((entry) => new JavascriptVariable(entry[0], entry[1]));

		// Emit the changes to the front end
		this._onDidEmitData.fire({
			msg_type: 'update',
			assigned: added,
			removed: removedKeys
		});

		// Remember the set of keys we emitted so we can deliver a diff next
		// time (see `scanForChanges`)
		this._keys = keys;
	}

	/**
	 * Performs the inspection of a variable
	 */
	private inspectVar(path: string[]) {
		// Recurse starting at the global object to find the variable
		const children = this.inspectVariable(path, global);

		// Emit the resulting variable to the front end
		this._onDidEmitData.fire({
			msg_type: 'details',
			children,
			length: children.length
		});
	}

	/**
	 * Recursively inspects a variable (or object property) and returns
	 * a list of its children
	 */
	private inspectVariable(path: string[], obj: any): JavascriptVariable[] {
		// If we've reached the end of the path, return the variable
		if (path.length === 1) {
			const val = obj[path[0]];
			switch (typeof (obj)) {
				case 'object': {
					// If the variable is an object, return its properties
					// as a list of JavascriptVariable objects
					return Object.entries(val).map((entry) => {
						return new JavascriptVariable(entry[0], entry[1]);
					});
					break;
				}
				default: {
					// If it isn't, just return the variable itself
					return [new JavascriptVariable(path[0], obj)];
				}
			}
		}

		// Peel off the next key in the path and recurse
		const key = path.shift();
		if (key === undefined) {
			// This should never happen
			return [];
		}
		return this.inspectVariable(path, obj[key]);
	}

	/**
	 * Emits a full list of variables to the front end
	 */
	private emitFullList() {
		// Replace the list of keys
		this._keys = Object.keys(global);

		// Create a list of all the variables in the global environment
		let vars = Object.entries(global).map((entry) => {
			return new JavascriptVariable(entry[0], entry[1]);
		});

		// Remove any variables that couldn't be stringified
		vars = vars.filter((variable) => variable !== null);

		// Emit the data to the front end
		this._onDidEmitData.fire({
			msg_type: 'list',
			variables: vars,
			length: vars.length
		});
	}
}
