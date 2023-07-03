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

	constructor(
		readonly display_name: string,
		readonly display_value: string,
		readonly display_type: string,
		readonly length: number,
		readonly size: number) {

		this.access_key = display_name;

		switch (display_type) {
			case 'number':
				this.kind = 'number';
				break;
			case 'object':
				this.kind = 'collection';
				break;
			case 'string':
				this.kind = 'string';
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

	/**
	 * Emits a full list of variables to the front end
	 */
	private emitFullList() {
		// Create a list of all the variables in the global environment
		let vars = Object.entries(global).map((entry) => {
			const [key, value] = entry;
			const kind = typeof (value as any);
			try {
				JSON.stringify(value);
				const variable = new JavascriptVariable(
					key,
					JSON.stringify(value),
					kind,
					kind === 'object' ? Object.keys(value).length : 0,
					0
				);
				return variable;
			} catch (e) {
				return null;
			}
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
