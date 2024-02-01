/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { generateUuid } from 'vs/base/common/uuid';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { ColumnSortKey, PositronDataToolComm, TableData, TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataToolComm';

/**
 * A data tool client instance.
 */
export class DataToolClientInstance extends Disposable {
	//#region Private Properties

	/**
	 * Gets the identifier.
	 */
	private readonly _identifier = generateUuid();

	/**
	 * Gets the PositronDataToolComm.
	 */
	private readonly _positronDataToolComm: PositronDataToolComm;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Creates a new data tool client instance.
	 * @param client The runtime client instance.
	 */
	constructor(client: IRuntimeClientInstance<any, any>) {
		// Call the disposable constrcutor.
		super();

		// Create and register the PositronDataToolComm on the client.
		this._positronDataToolComm = new PositronDataToolComm(client);
		this._register(this._positronDataToolComm);

		// Setup events.
		this.onDidClose = this._positronDataToolComm.onDidClose;
	}

	//#endregion Constructor & Dispose

	//#region Public Properties

	/**
	 * Gets the identifier.
	 */
	get identifier() {
		return this._identifier;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Gets the schema.
	 * @returns A promise that resolves to the table schema.
	 */
	async getSchema(): Promise<TableSchema> {
		// TODO: implement paging
		return this._positronDataToolComm.getSchema(0, 10000);
	}

	/**
	 * Get a rectangle of data values.
	 * @param rowStartIndex The first row to fetch (inclusive).
	 * @param numRows The number of rows to fetch from start index. May extend beyond end of table.
	 * @param columnIndices Indices to select, which can be a sequential, sparse, or random selection.
	 * @returns A Promise<TableData> that resolves when the operation is complete.
	 */
	async getDataValues(
		rowStartIndex: number,
		numRows: number,
		columnIndices: Array<number>
	): Promise<TableData> {
		return this._positronDataToolComm.getDataValues(rowStartIndex, numRows, columnIndices);
	}

	/**
	 * Set or clear the columns(s) to sort by, replacing any previous sort columns.
	 * @param sortKeys Pass zero or more keys to sort by. Clears any existing keys.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setSortColumns(sortKeys: Array<ColumnSortKey>): Promise<void> {
		return this._positronDataToolComm.setSortColumns(sortKeys);
	}

	//#endregion Public Methods

	//#region Public Events

	/**
	 * The onDidClose event.
	 */
	onDidClose: Event<void>;

	//#endregion Public Events
}
