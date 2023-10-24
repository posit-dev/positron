/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { DataColumn, DataSet, DataViewerMessageRowRequest, DataViewerMessageRowResponse } from './positron-data-viewer';

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
		//this.data = Array.from({ length }, () => Math.floor(Math.random() * 100));
		// Create an array of sequential numbers of the requested length
		this.data = Array.from({ length }, (_, i) => i);
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

	sliceData(start: number, size: number): Array<ZedColumn> {
		if (start < 0 || start >= this.rowCount) {
			throw new Error(`Invalid start index: ${start}`);
		} else if (start === 0 && this.rowCount <= size) {
			// No need to slice the data
			return this.columns;
		}

		return this.columns.map((column) => {
			return {
				...column,
				data: column.data.slice(start, start + size)
			};
		});
	}

	handleMessage(message: any): void {
		switch (message.msg_type) {
			case 'ready':
			case 'request_rows':
				this.sendData(message as DataViewerMessageRowRequest);
				break;
			default:
				console.error(`ZedData ${this.id} got unknown message type: ${message.msg_type}`);
				break;
		}
	}

	public sendData(message: DataViewerMessageRowRequest): void {
		const response: DataViewerMessageRowResponse = {
			msg_type: message.msg_type === 'ready' ? 'initial_data' : 'receive_rows',
			start_row: message.start_row,
			fetch_size: message.fetch_size,
			data: {
				id: this.id,
				title: this.title,
				columns: this.sliceData(message.start_row, message.fetch_size),
				rowCount: this.rowCount
			} as ZedData,
		};
		// Emit to the front end.
		this._onDidEmitData.fire(response);
	}
}
