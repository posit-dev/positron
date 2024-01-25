/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { PositronZedLanguageRuntime } from './positronZedLanguageRuntime';

/**
 * A ZedConnection instance; simulates a real database connection.
 */
export class ZedConnection {
	// The unique ID for this connection (randomly generated)
	public readonly id;

	/**
	 * Emitter that handles outgoing messages to the front end
	 */
	private readonly _onDidEmitData = new vscode.EventEmitter<object>();
	onDidEmitData: vscode.Event<object> = this._onDidEmitData.event;

	constructor(readonly zed: PositronZedLanguageRuntime,
		readonly name: string) {
		this.id = randomUUID();
	}

	/**
	 * Handles an incoming message from the Positron front end
	 *
	 * @param message The message to handle
	 */
	public handleMessage(message: any) {
		switch (message.msg_type) {

			// A request to list the tables
			case 'tables_request':

				if (message.path.length > 0) {
					if (message.path[0].kind === 'schema') {
						// Emit the data to the front end
						this._onDidEmitData.fire({
							msg_type: 'tables_response',
							tables: [
								{ name: 'table1', kind: 'table' },
								{ name: 'table2', kind: 'table' },
							]
						});
						break;
					}
				}

				// Emit the data to the front end
				this._onDidEmitData.fire({
					msg_type: 'tables_response',
					tables: [
						{ name: 'table1', kind: 'table' },
						{ name: 'table2', kind: 'table' },
						{ name: 'schema1', kind: 'schema' },
					]
				});
				break;

			// A request to list the fields in a table
			case 'fields_request':
				// Emit the data to the front end
				this._onDidEmitData.fire({
					msg_type: 'fields_response',
					fields: [
						{ name: 'field1', dtype: 'numeric' },
						{ name: 'field2', dtype: 'character' },
						{ name: 'field3', dtype: 'integer' },
					]
				});
				break;

			// A request to preview a table
			case 'preview_table':
				this.zed.createZedDataView(randomUUID(), message.table);
				break;
		}
	}
}
