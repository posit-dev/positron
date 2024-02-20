/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { generateUuid } from 'vs/base/common/uuid';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { ColumnSortKey, PositronDataExplorerComm, SchemaUpdateEvent, TableData, TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * A data explorer client instance.
 */
export class DataExplorerClientInstance extends Disposable {
	//#region Private Properties

	/**
	 * Gets the identifier.
	 */
	private readonly _identifier = generateUuid();

	/**
	 * Gets the PositronDataExplorerComm.
	 */
	private readonly _positronDataExplorerComm: PositronDataExplorerComm;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Creates a new data explorer client instance.
	 * @param client The runtime client instance.
	 */
	constructor(client: IRuntimeClientInstance<any, any>) {
		// Call the disposable constrcutor.
		super();

		// Create and register the PositronDataExplorerComm on the client.
		this._positronDataExplorerComm = new PositronDataExplorerComm(client);
		this._register(this._positronDataExplorerComm);

		// Close emitter
		this.onDidClose = this._positronDataExplorerComm.onDidClose;

		// Connect schema update emitter
		this.onDidSchemaUpdate = this._schemaUpdateEmitter.event;

		// Connect data update emitter
		this.onDidDataUpdate = this._dataUpdateEmitter.event;

		this._positronDataExplorerComm.onDidSchemaUpdate(async (e: SchemaUpdateEvent) => {
			this._schemaUpdateEmitter.fire(e);
		});

		this._positronDataExplorerComm.onDidDataUpdate(async (_evt) => {
			this._dataUpdateEmitter.fire();
		});
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
	async getSchema(startIndex: number, numColumns: number): Promise<TableSchema> {
		return this._positronDataExplorerComm.getSchema(startIndex, numColumns);
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
		return this._positronDataExplorerComm.getDataValues(rowStartIndex, numRows, columnIndices);
	}

	/**
	 * Set or clear the columns(s) to sort by, replacing any previous sort columns.
	 * @param sortKeys Pass zero or more keys to sort by. Clears any existing keys.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setSortColumns(sortKeys: Array<ColumnSortKey>): Promise<void> {
		return this._positronDataExplorerComm.setSortColumns(sortKeys);
	}

	//#endregion Public Methods

	//#region Public Events


	/**
	 * Event that fires when the data explorer is closed on the runtime side, as a result of
	 * a dataset being deallocated or overwritten with a non-dataset.
	 */
	onDidClose: Event<void>;

	/**
	 * Event that fires when the schema has been updated.
	 */
	onDidSchemaUpdate: Event<SchemaUpdateEvent>;
	private readonly _schemaUpdateEmitter = new Emitter<SchemaUpdateEvent>();

	/**
	 * Event that fires when the data has been updated.
	 */
	onDidDataUpdate: Event<void>;
	private readonly _dataUpdateEmitter = new Emitter<void>();

	//#endregion Public Events
}
