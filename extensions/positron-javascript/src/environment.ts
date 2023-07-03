/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

class JavascriptVariable {
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
				this.kind = 'number';
				break;
			case 'object':
				this.kind = 'collection';
				this.length = Object.keys(value).length;
				this.has_children = this.length > 0;
				break;
			case 'string':
				this.kind = 'string';
				this.size = this.display_value.length;
				break;
			case 'undefined':
				this.kind = 'empty';
				break;
			default:
				this.kind = 'other';
		}

		this.has_children = this.kind === 'collection';
	}

}

export class JavascriptEnvironment {

	private _keys: Array<string> = [];
	private readonly _onDidEmitData = new vscode.EventEmitter<object>();

	onDidEmitData: vscode.Event<object> = this._onDidEmitData.event;

	/**
	 * Creates a new ZedEnvironment backend
	 *
	 * @param id The ID of the environment client instance
	 */
	constructor(readonly id: string) {

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

			// A request to clear the environment
			case 'clear':
				// this.clearAllVars();
				break;

			// A request to delete a set of variables
			case 'delete':
				// this.deleteVars(message.names);
				break;

			// A request to inspect a variable
			case 'inspect':
				// this.inspectVar(message.path);
				break;

			// A request to format a variable as a string suitable for placing on the clipboard
			case 'clipboard_format':
				// this.formatVariable(message.format, message.path);
				break;

		}
	}

	public scanForChanges() {
		const newKeys = Object.keys(global);
		const addedKeys = newKeys.filter((key) => !this._keys.includes(key));
		const removedKeys = this._keys.filter((key) => !newKeys.includes(key));

		const added = Object.entries(global)
			.filter((entry) => addedKeys.includes(entry[0]))
			.map((entry) => new JavascriptVariable(entry[0], entry[1]));

		this._onDidEmitData.fire({
			msg_type: 'update',
			assigned: added,
			removed: removedKeys
		});
	}

	/**
	 * Emits a full list of variables to the front end
	 */
	private emitFullList() {
		// Forget the list of keys we have
		this._keys = [];

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
