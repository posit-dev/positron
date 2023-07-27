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
	public readonly id: string;
	public readonly columns: Array<ZedColumn> = [];

	/**
	 * Create a new ZedData instance
	 *
	 * @param context The extension context
	 * @param title The title of the data set (for display in data viewer tab)
	 * @param nrow The number of rows
	 * @param ncol The number of columns
	 */
	constructor(private readonly context: vscode.ExtensionContext,
		public readonly title: string,
		public readonly rowCount = 1000,
		private readonly colCount = 10) {
		// Create a unique ID for this instance
		this.id = randomUUID();

		// Create the requested number of columns
		for (let i = 0; i < colCount; i++) {
			this.columns.push(new ZedColumn(`Column ${i}`, 'number', rowCount));
		}
	}

	handleMessage(message: any): void {
	}
}
