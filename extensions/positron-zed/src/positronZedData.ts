/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { DataColumn, DataSet } from './positron-data-viewer';

/**
 * A Zed column; this is a mock of a Zed column that fulfills the DataColumn
 * interface.
 */
class ZedColumn implements DataColumn {
	public readonly name: string;
	public readonly type: string;
	public readonly data: Array<number>;
	constructor(name: string, type: string, length: number) {
		this.name = name;
		this.type = type;
		// Create an array of random numbers of the requested length
		this.data = Array.from({ length }, () => Math.floor(Math.random() * 100));
	}
}

/**
 * A ZedData instance; this is a mock of a Zed data set that fulfills the
 * DataSet interface suitable for use with the Positron data viewer.
 */
export class ZedData implements DataSet {
	/**
	 * Emitter that handles outgoing messages to the front end
	 */
	private readonly _onDidEmitData = new vscode.EventEmitter<object>();
	onDidEmitData: vscode.Event<object> = this._onDidEmitData.event;

	public readonly id: string;
	public readonly columns: Array<ZedColumn> = [];

	/**
	 * Create a new ZedData instance
	 *
	 * @param title The title of the data set (for display in data viewer tab)
	 * @param rowCount The number of rows
	 * @param colCount The number of columns
	 */
	constructor(readonly title: string,
		public readonly rowCount = 1000,
		colCount = 10) {
		// Create a unique ID for this instance
		this.id = randomUUID();
		// Create the requested number of columns
		for (let i = 0; i < colCount; i++) {
			this.columns.push(new ZedColumn(`Column ${i}`, 'number', rowCount));
		}
	}

	handleMessage(message: any): void {
		console.log(`ZedData ${this.id} got message: ${JSON.stringify(message)}`);
		switch (message.msg_type) {
			case 'initial_data':
			case 'receive_rows':
				console.log(`ZedData ${this.id} got ${message.msg_type} message`);
				break;
			default:
				console.error(`ZedData ${this.id} got unknown message type: ${message.msg_type}`);
				break;
		}
	}
}
