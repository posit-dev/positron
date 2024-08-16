/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from 'vs/base/common/async';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { generateUuid } from 'vs/base/common/uuid';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { ArraySelection, BackendState, ColumnProfileRequest, ColumnProfileResult, ColumnSchema, ColumnSelection, ColumnSortKey, ExportedData, ExportFormat, FilterResult, FormatOptions, PositronDataExplorerComm, ReturnColumnProfilesEvent, RowFilter, SchemaUpdateEvent, SupportedFeatures, SupportStatus, TableData, TableRowLabels, TableSchema, TableSelection } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

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

export enum DataExplorerClientStatus {
	Idle,
	Computing,
	Disconnected,
	Error
}

/**
 * A data explorer client instance.
 */
export class DataExplorerClientInstance extends Disposable {
	//#region Private Properties

	/**
	 * The current cached backend state.
	 */
	public cachedBackendState: BackendState | undefined = undefined;

	/**
	 * The latest client status.
	 */
	public status: DataExplorerClientStatus = DataExplorerClientStatus.Idle;

	/**
	 * A promise resolving to an active request for the backend state.
	 */
	private _backendPromise: Promise<BackendState> | undefined = undefined;

	/**
	 * Gets the PositronDataExplorerComm.
	 */
	private readonly _positronDataExplorerComm: PositronDataExplorerComm;

	/**
	 * The onDidClose event emitter.
	 *
	 * Note that this is not registered with the default disposable store
	 * since can be fired during disposal.
	 */
	private readonly _onDidCloseEmitter = new Emitter<void>();

	/**
	 * The onDidSchemaUpdate event emitter.
	 */
	private readonly _onDidSchemaUpdateEmitter = this._register(new Emitter<SchemaUpdateEvent>());

	/**
	 * The onDidUpdateBackendState event emitter.
	 */
	private readonly _onDidUpdateBackendStateEmitter = this._register(new Emitter<BackendState>);

	/**
	 * The onDidDataUpdate event emitter.
	 */
	private readonly _onDidDataUpdateEmitter = this._register(new Emitter<void>());

	/**
	 * The onDidStatusUpdate event emitter.
	 */
	private readonly _onDidStatusUpdateEmitter = this._register(new Emitter<DataExplorerClientStatus>());

	/**
	 * Number of pending backend requests. When returns to 0, status is set to Idle.
	 */
	private _numPendingTasks: number = 0;

	/**
	 * Data formatting options for backend requests
	 */
	_dataFormatOptions: FormatOptions;

	/**
	 * Profile formatting options for backend requests
	 */
	_profileFormatOptions: FormatOptions;

	/**
	 * Promises for asynchronous tasks requested of the backend, keyed by callback ID.
	 */
	private readonly _asyncTasks = new Map<string, DeferredPromise<any>>();

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Creates a new data explorer client instance.
	 * @param client The runtime client instance.
	 */
	constructor(client: IRuntimeClientInstance<any, any>) {
		// Call the disposable constructor.
		super();

		this._dataFormatOptions = {
			large_num_digits: 2,
			small_num_digits: 4,
			max_integral_digits: 7,
			max_value_length: 1000,
			thousands_sep: '',
		};

		this._profileFormatOptions = {
			large_num_digits: 2,
			small_num_digits: 4,
			max_integral_digits: 7,
			max_value_length: 1000,
			thousands_sep: ','
		};

		// Create and register the PositronDataExplorerComm on the client.
		this._positronDataExplorerComm = new PositronDataExplorerComm(client);
		this._register(this._positronDataExplorerComm);

		// Register the onDidClose event handler.
		this._register(this._positronDataExplorerComm.onDidClose(() => {
			this.setStatus(DataExplorerClientStatus.Disconnected);
			this._onDidCloseEmitter.fire();
		}));

		// Register the onDidSchemaUpdate event handler.
		this._register(this._positronDataExplorerComm.onDidSchemaUpdate(async (e: SchemaUpdateEvent) => {
			// Refresh the cached backend state.
			await this.updateBackendState();

			// Fire the onDidSchemaUpdate event.
			this._onDidSchemaUpdateEmitter.fire(e);
		}));

		// Register the onDidDataUpdate event handler.
		this._register(this._positronDataExplorerComm.onDidDataUpdate(async () => {
			// Refresh the cached backend state.
			await this.updateBackendState();

			// Fire the onDidDataUpdate event.
			this._onDidDataUpdateEmitter.fire();
		}));

		// Register the onDidReturnColumnProfiles event handler.
		this._register(this._positronDataExplorerComm.onDidReturnColumnProfiles(async (e: ReturnColumnProfilesEvent) => {
			if (this._asyncTasks.has(e.callback_id)) {
				const promise = this._asyncTasks.get(e.callback_id);
				promise?.complete(e.profiles);
				this._asyncTasks.delete(e.callback_id);
			}
		}));
	}

	override dispose(): void {
		// Call the base class's dispose method.
		super.dispose();

		// Dispose of the close emitter. We need to do this after calling the
		// base class's dispose method so that the `onDidClose` event can be fired
		// and handled during disposal.
		this._onDidCloseEmitter.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Public Properties

	/**
	 * Gets the identifier.
	 */
	get identifier() {
		return this._positronDataExplorerComm.clientId;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Get the current active state of the data explorer backend.
	 * @returns A promose that resolves to the current backend state.
	 */
	async getBackendState(): Promise<BackendState> {
		if (this._backendPromise) {
			// If there is a request for the state pending
			return this._backendPromise;
		} else if (this.cachedBackendState === undefined) {
			// The state is being requested for the first time
			return this.updateBackendState();
		} else {
			// The state was previously computed
			return this.cachedBackendState;
		}
	}

	/**
	 * Requests a fresh update of the backend state and fires event to notify state listeners.
	 * @returns A promise that resolves to the latest table state.
	 */
	async updateBackendState(): Promise<BackendState> {
		if (this._backendPromise) {
			return this._backendPromise;
		}

		this._backendPromise = this.runBackendTask(
			() => this._positronDataExplorerComm.getState(),
			() => ({
				display_name: 'disconnected',
				table_shape: { num_rows: 0, num_columns: 0 },
				table_unfiltered_shape: { num_rows: 0, num_columns: 0 },
				has_row_labels: false,
				column_filters: [],
				row_filters: [],
				sort_keys: [],
				supported_features: {
					search_schema: {
						support_status: SupportStatus.Unsupported,
						supported_types: []
					},
					set_column_filters: {
						support_status: SupportStatus.Unsupported,
						supported_types: []
					},
					set_row_filters: {
						support_status: SupportStatus.Unsupported,
						supports_conditions: SupportStatus.Unsupported,
						supported_types: []
					},
					get_column_profiles: {
						support_status: SupportStatus.Unsupported,
						supported_types: []
					},
					set_sort_columns: { support_status: SupportStatus.Unsupported, },
					export_data_selection: {
						support_status: SupportStatus.Unsupported,
						supported_formats: []
					}
				}
			})
		);

		this.cachedBackendState = await this._backendPromise;
		this._backendPromise = undefined;

		// Notify listeners
		this._onDidUpdateBackendStateEmitter.fire(this.cachedBackendState);

		// Fulfill to anyone waiting on the backend state.
		return this.cachedBackendState;
	}

	/**
	 * Gets the schema.
	 * @param columnIndices The column indices.
	 * @returns A promise that resolves to the table schema.
	 */
	async getSchema(columnIndices: Array<number>): Promise<TableSchema> {
		return this.runBackendTask(
			() => this._positronDataExplorerComm.getSchema(columnIndices),
			() => ({ columns: [] })
		);
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
		const tableState = await this.getBackendState();

		// Load the entire schema of the table so it can be searched.
		const tableSchema = await this._positronDataExplorerComm.getSchema(
			[...Array(tableState.table_shape.num_columns).keys()]
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
	 * Request formatted values from table columns.
	 * @param columns Array of column selections.
	 * @returns A Promise<TableData> that resolves when the operation is complete.
	 */
	async getDataValues(columns: Array<ColumnSelection>): Promise<TableData> {
		return this.runBackendTask(
			() => this._positronDataExplorerComm.getDataValues(columns, this._dataFormatOptions),
			() => ({ columns: [[]] })
		);
	}

	/**
	 * Retrieve row labels from a table (if it has them).
	 * @param selection An ArraySelection for the row labels to fetch.
	 * @returns A Promise<TableRowLabels> that resolves when the operation is complete.
	 */
	async getRowLabels(
		selection: ArraySelection,
	): Promise<TableRowLabels> {
		return this.runBackendTask(
			() => this._positronDataExplorerComm.getRowLabels(selection,
				this._dataFormatOptions
			),
			() => ({ row_labels: [[]] })
		);
	}

	/**
	 * Request a batch of column profiles
	 * @param profiles An array of profile types and colum indexes
	 * @returns A Promise<Array<ColumnProfileResult>> that resolves when the operation is complete.
	 */
	async getColumnProfiles(
		profiles: Array<ColumnProfileRequest>
	): Promise<Array<ColumnProfileResult>> {
		return this.runBackendTask(
			async () => {
				const callbackId = generateUuid();
				const promise = new DeferredPromise<Array<ColumnProfileResult>>();
				this._asyncTasks.set(callbackId, promise);
				await this._positronDataExplorerComm.getColumnProfiles(callbackId, profiles, this._profileFormatOptions);

				const timeout = 10000;

				// Don't leave unfulfilled promise indefinitely; reject after 10 seconds pass
				// for now just in case
				setTimeout(() => {
					// If the promise has already been resolved, do nothing.
					if (promise.isSettled) {
						return;
					}

					// Otherwise, reject the promise and remove it from the list of pending RPCs.
					const timeoutSeconds = Math.round(timeout / 100) / 10;  // round to 1 decimal place
					promise.error(new Error(`get_column_profiles timed out after ${timeoutSeconds} seconds`));
					this._asyncTasks.delete(callbackId);
				}, timeout);

				return promise.p;
			},
			() => []
		);
	}

	/**
	 * Export data selection as a string in different formats
	 *
	 * Export data selection as a string in different formats like CSV, TSV,
	 * HTML
	 *
	 * @param selection The data selection
	 * @param format Result string format
	 *
	 * @returns Exported result
	 */
	async exportDataSelection(selection: TableSelection, format: ExportFormat): Promise<ExportedData> {
		return this.runBackendTask(
			() => this._positronDataExplorerComm.exportDataSelection(selection, format),
			() => ({
				data: '',
				format
			})
		);
	}

	/**
	 * Sets row filters.
	 * @param rowFilters The row filters.
	 * @returns A Promise<FilterResult> that resolves when the operation is complete.
	 */
	async setRowFilters(filters: Array<RowFilter>): Promise<FilterResult> {
		return this.runBackendTask(
			() => this._positronDataExplorerComm.setRowFilters(filters),
			() => ({ selected_num_rows: 0 })
		);
	}

	/**
	 * Set or clear the columns(s) to sort by, replacing any previous sort columns.
	 * @param sortKeys Pass zero or more keys to sort by. Clears any existing keys.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setSortColumns(sortKeys: Array<ColumnSortKey>): Promise<void> {
		return this.runBackendTask(
			() => this._positronDataExplorerComm.setSortColumns(sortKeys),
			() => { }
		);
	}

	getSupportedFeatures(): SupportedFeatures {
		if (this.cachedBackendState === undefined) {
			// Until the backend state is available, we disable features.
			return {
				search_schema: {
					support_status: SupportStatus.Unsupported,
					supported_types: []
				},
				set_column_filters: {
					support_status: SupportStatus.Unsupported,
					supported_types: []
				},
				set_row_filters: {
					support_status: SupportStatus.Unsupported,
					supports_conditions: SupportStatus.Unsupported,
					supported_types: []
				},
				get_column_profiles: {
					support_status: SupportStatus.Unsupported,
					supported_types: []
				},
				set_sort_columns: { support_status: SupportStatus.Unsupported },
				export_data_selection: {
					support_status: SupportStatus.Unsupported,
					supported_formats: []
				}
			};
		} else {
			return this.cachedBackendState.supported_features;
		}
	}

	//#endregion Public Methods

	//#region Private Methods

	private async runBackendTask<Type, F extends () => Promise<Type>,
		Alt extends () => Type>(task: F, disconnectedResult: Alt) {
		if (this.status === DataExplorerClientStatus.Disconnected) {
			return disconnectedResult();
		}
		this._numPendingTasks += 1;
		this.setStatus(DataExplorerClientStatus.Computing);
		try {
			return await task();
		} finally {
			this._numPendingTasks -= 1;
			if (this._numPendingTasks === 0) {
				this.setStatus(DataExplorerClientStatus.Idle);
			}
		}
	}

	private setStatus(status: DataExplorerClientStatus) {
		this.status = status;
		this._onDidStatusUpdateEmitter.fire(status);
	}

	//#endregion Private Methods

	//#region Public Events

	/**
	 * Event that fires when the data explorer is closed on the runtime side, as a result of
	 * a dataset being deallocated or overwritten with a non-dataset.
	 */
	onDidClose = this._onDidCloseEmitter.event;

	/**
	 * Event that fires when the schema has been updated.
	 */
	onDidSchemaUpdate = this._onDidSchemaUpdateEmitter.event;

	/**
	 * Event that fires when the backend state has been updated.
	 */
	onDidUpdateBackendState = this._onDidUpdateBackendStateEmitter.event;

	/**
	 * Event that fires when the data has been updated.
	 */
	onDidDataUpdate = this._onDidDataUpdateEmitter.event;

	/**
	 * Event that fires when the status has been updated.
	 */
	onDidStatusUpdate = this._onDidStatusUpdateEmitter.event;

	//#endregion Public Events
}
