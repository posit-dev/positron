/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import {
	BackendState,
	ColumnProfileRequest,
	ColumnProfileResult,
	ColumnSchema,
	ColumnSortKey,
	FilterResult,
	PositronDataExplorerComm,
	RowFilter,
	SchemaUpdateEvent,
	TableData,
	TableSchema
} from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * TableSchemaSearchResult interface. This is here temporarily until searching the tabe schema
 * becomespart of the PositronDataExplorerComm.
 */
export interface TableSchemaSearchResult {
	/**
	 * The number of matching columns.
	 */
	matching_columns: number;

	/**
	 * Column schema for the matching columns.
	 */
	columns: Array<ColumnSchema>;
}

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

	/**
	 * The onDidSchemaUpdate event emitter.
	 */
	private readonly _onDidSchemaUpdateEmitter = this._register(new Emitter<SchemaUpdateEvent>());

	/**
	 * The onDidDataUpdate event emitter.
	 */
	private readonly _onDidDataUpdateEmitter = this._register(new Emitter<void>());

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

		this._positronDataExplorerComm.onDidSchemaUpdate(async (e: SchemaUpdateEvent) => {
			this._onDidSchemaUpdateEmitter.fire(e);
		});

		this._positronDataExplorerComm.onDidDataUpdate(async (_evt) => {
			this._onDidDataUpdateEmitter.fire();
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
	 * Get the current active state of the data explorer backend.
	 * @returns A promose that resolves to the current table state.
	 */
	async getState(): Promise<BackendState> {
		return this._positronDataExplorerComm.getState();
	}

	/**
	 * Gets the schema.
	 * @param startIndex The starting index.
	 * @param numColumns The number of columns to return.
	 * @returns A promise that resolves to the table schema.
	 */
	async getSchema(startIndex: number, numColumns: number): Promise<TableSchema> {
		return this._positronDataExplorerComm.getSchema(startIndex, numColumns);
	}

	/**
	 * Searches the table schema.
	 * @param searchText The search text.
	 * @param startIndex The starting index.
	 * @param numColumns The number of columns to return.
	 * @returns A TableSchemaSearchResult that contains the search result.
	 */
	async searchSchema(options: {
		searchText?: string;
		startIndex: number;
		numColumns: number;
	}): Promise<TableSchemaSearchResult> {
		/**
		 * Brute force temporary implementation.
		 */

		// Get the table state so we know now many columns there are.
		const tableState = await this._positronDataExplorerComm.getState();

		// Load the entire schema of the table so it can be searched.
		const tableSchema = await this._positronDataExplorerComm.getSchema(
			0,
			tableState.table_shape.num_columns
		);

		// Search the columns finding every matching one.
		const columns = tableSchema.columns.filter(columnSchema =>
			!options.searchText ? true : columnSchema.column_name.includes(options.searchText)
		);

		// Return the result.
		return {
			matching_columns: columns.length,
			columns: columns.slice(options.startIndex, options.numColumns)
		};
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
	 * Request a batch of column profiles
	 * @param profiles An array of profile types and colum indexes
	 * @returns A Promise<Array<ColumnProfileResult>> that resolves when the operation is complete.
	 */
	async getColumnProfiles(
		profiles: Array<ColumnProfileRequest>
	): Promise<Array<ColumnProfileResult>> {
		return this._positronDataExplorerComm.getColumnProfiles(profiles);
	}

	/**
	 * Sets row filters.
	 * @param rowFilters The row filters.
	 * @returns A Promise<FilterResult> that resolves when the operation is complete.
	 */
	async setRowFilters(filters: Array<RowFilter>): Promise<FilterResult> {
		return this._positronDataExplorerComm.setRowFilters(filters);
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
	onDidSchemaUpdate = this._onDidSchemaUpdateEmitter.event;

	/**
	 * Event that fires when the data has been updated.
	 */
	onDidDataUpdate = this._onDidDataUpdateEmitter.event;

	//#endregion Public Events
}
