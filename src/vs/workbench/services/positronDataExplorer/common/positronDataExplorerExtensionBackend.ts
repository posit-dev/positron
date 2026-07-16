/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IDataExplorerBackendClient } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import {
	ArraySelection,
	BackendState,
	CodeSyntaxName,
	ColumnFilter,
	ColumnProfileRequest,
	ColumnSelection,
	ColumnSortKey,
	ConvertedCode,
	DataExplorerBackendRequest,
	DataExplorerFrontendEvent,
	DataUpdateEvent,
	ExportDataSelectionParams,
	ExportedData,
	ExportFormat,
	FilterResult,
	FormatOptions,
	GetColumnProfilesParams,
	GetDataValuesParams,
	GetRowLabelsParams,
	GetSchemaParams,
	ReturnColumnProfilesEvent,
	RowFilter,
	SchemaUpdateEvent,
	SearchSchemaParams,
	SearchSchemaResult,
	SearchSchemaSortOrder,
	SetColumnFiltersParams,
	SetRowFiltersParams,
	SetSortColumnsParams,
	TableData,
	TableRowLabels,
	TableSchema,
	TableSelection,
} from '../../languageRuntime/common/positronDataExplorerComm.js';
import { IDataExplorerRpcDto, IDataExplorerResponseDto, IDataExplorerRpcTransport, IDataExplorerUiEventDto } from './dataExplorerRpcTransport.js';

/**
 * A Data Explorer backend whose RPCs are serviced by a built-in extension over the typed
 * `MainThreadDataExplorer` <-> `ExtHostDataExplorer` channel.
 *
 * It implements `IDataExplorerBackendClient` by forwarding each request through an
 * `IDataExplorerRpcTransport`, tagging every request with a stable `identifier` (the dataset id)
 * so the providing extension can route it to the right table view. Async frontend events (e.g.
 * column profiles) arrive via `handleUiEvent`, dispatched by the service from the channel.
 *
 * Subclasses (e.g. the DuckDB file backend) may set `initialSetup` to a bootstrap promise that
 * `_execRpc` awaits before the first request.
 */
export class PositronDataExplorerExtensionBackend extends Disposable implements IDataExplorerBackendClient {
	/**
	 * The core-side client id (the Data Explorer instance key and editor URI). For most providers
	 * this equals {@link datasetUri}; the DuckDB file backend prefixes it (e.g. `duckdb:<fileUri>`).
	 */
	readonly clientId: string;

	/**
	 * The dataset identifier sent as the RPC `uri` and used by the providing extension to key its
	 * table views and to tag the UI events it pushes back.
	 */
	readonly datasetUri: string;

	// Events for the IDataExplorerBackendClient interface.
	private readonly _onDidCloseEmitter = this._register(new Emitter<void>);
	private readonly _onDidSchemaUpdateEmitter = this._register(new Emitter<SchemaUpdateEvent>);
	private readonly _onDidDataUpdateEmitter = this._register(new Emitter<DataUpdateEvent>);
	private readonly _onDidReturnColumnProfilesEmitter = this._register(
		new Emitter<ReturnColumnProfilesEvent>);

	readonly onDidClose = this._onDidCloseEmitter.event;
	readonly onDidSchemaUpdate = this._onDidSchemaUpdateEmitter.event;
	readonly onDidDataUpdate = this._onDidDataUpdateEmitter.event;
	readonly onDidReturnColumnProfiles = this._onDidReturnColumnProfilesEmitter.event;

	/** Optional bootstrap awaited before the first RPC (e.g. DuckDB's open_dataset). */
	protected initialSetup: Promise<unknown> | undefined;

	/**
	 * Constructor.
	 * @param _transport The transport used to reach the providing extension.
	 * @param _providerId The provider that owns this dataset (e.g. 'positron-duckdb').
	 * @param datasetUri The dataset identifier sent as the RPC `uri`.
	 * @param clientId The core-side client id; defaults to `datasetUri`.
	 */
	constructor(
		private readonly _transport: IDataExplorerRpcTransport,
		private readonly _providerId: string,
		datasetUri: string,
		clientId: string = datasetUri,
	) {
		super();
		this.datasetUri = datasetUri;
		this.clientId = clientId;

		// When this backend is disposed (the Data Explorer editor tab closed), tell the providing
		// extension so it can release the dataset's resources -- e.g. the DuckDB provider shuts its
		// worker down once its last dataset closes. Runs once, only if not already disposed.
		this._register(toDisposable(() => this._transport.disposeBackend(this._providerId, this.datasetUri)));
	}

	/**
	 * Routes a UI event from the providing extension to the matching emitter.
	 */
	handleUiEvent(event: IDataExplorerUiEventDto) {
		if (event.method === DataExplorerFrontendEvent.ReturnColumnProfiles) {
			this._onDidReturnColumnProfilesEmitter.fire(event.params as ReturnColumnProfilesEvent);
		} else if (event.method === DataExplorerFrontendEvent.DataUpdate) {
			this._onDidDataUpdateEmitter.fire({});
		} else if (event.method === DataExplorerFrontendEvent.SchemaUpdate) {
			this._onDidSchemaUpdateEmitter.fire(event.params as SchemaUpdateEvent);
		}
	}

	protected async _execRpc<Type>(rpc: IDataExplorerRpcDto): Promise<Type> {
		// Awaiting a possibly-undefined initialSetup is a no-op; subclasses set it to a bootstrap.
		await this.initialSetup;

		const response: IDataExplorerResponseDto = await this._transport.handleRpc(this._providerId, rpc);
		if (response.error_message) {
			return Promise.reject(new Error(response.error_message));
		}
		return response.result as Type;
	}

	async getState(): Promise<BackendState> {
		return this._execRpc<BackendState>({
			method: DataExplorerBackendRequest.GetState,
			uri: this.datasetUri,
			params: {}
		});
	}

	async getSchema(columnIndices: Array<number>): Promise<TableSchema> {
		return this._execRpc<TableSchema>({
			method: DataExplorerBackendRequest.GetSchema,
			uri: this.datasetUri,
			params: { column_indices: columnIndices } satisfies GetSchemaParams
		});
	}

	async searchSchema(filters: Array<ColumnFilter>, sortOrder: SearchSchemaSortOrder): Promise<SearchSchemaResult> {
		return this._execRpc<SearchSchemaResult>({
			method: DataExplorerBackendRequest.SearchSchema,
			uri: this.datasetUri,
			params: {
				filters: filters,
				sort_order: sortOrder
			} satisfies SearchSchemaParams
		});
	}

	async getDataValues(columns: Array<ColumnSelection>, formatOptions: FormatOptions): Promise<TableData> {
		return this._execRpc<TableData>({
			method: DataExplorerBackendRequest.GetDataValues,
			uri: this.datasetUri,
			params: {
				columns,
				format_options: formatOptions
			} satisfies GetDataValuesParams
		});
	}

	async getRowLabels(selection: ArraySelection, formatOptions: FormatOptions): Promise<TableRowLabels> {
		return this._execRpc<TableRowLabels>({
			method: DataExplorerBackendRequest.GetRowLabels,
			uri: this.datasetUri,
			params: {
				selection,
				format_options: formatOptions
			} satisfies GetRowLabelsParams
		});
	}

	async exportDataSelection(selection: TableSelection, format: ExportFormat): Promise<ExportedData> {
		return this._execRpc<ExportedData>({
			method: DataExplorerBackendRequest.ExportDataSelection,
			uri: this.datasetUri,
			params: {
				selection,
				format
			} satisfies ExportDataSelectionParams
		});
	}

	async suggestCodeSyntax(): Promise<CodeSyntaxName> {
		return this._execRpc<CodeSyntaxName>({
			method: DataExplorerBackendRequest.SuggestCodeSyntax,
			uri: this.datasetUri,
			params: {}
		});
	}

	async convertToCode(columnFilters: Array<ColumnFilter>, rowFilters: Array<RowFilter>, sortKeys: Array<ColumnSortKey>, codeSyntax: CodeSyntaxName): Promise<ConvertedCode> {
		return this._execRpc<ConvertedCode>({
			method: DataExplorerBackendRequest.ConvertToCode,
			uri: this.datasetUri,
			params: {
				column_filters: columnFilters,
				row_filters: rowFilters,
				sort_keys: sortKeys,
				code_syntax: codeSyntax
			}
		});
	}

	async setColumnFilters(filters: Array<ColumnFilter>): Promise<void> {
		return this._execRpc<void>({
			method: DataExplorerBackendRequest.SetColumnFilters,
			uri: this.datasetUri,
			params: { filters } satisfies SetColumnFiltersParams
		});
	}

	async setRowFilters(filters: Array<RowFilter>): Promise<FilterResult> {
		return this._execRpc<FilterResult>({
			method: DataExplorerBackendRequest.SetRowFilters,
			uri: this.datasetUri,
			params: { filters } satisfies SetRowFiltersParams
		});
	}

	async setSortColumns(sortKeys: Array<ColumnSortKey>): Promise<void> {
		return this._execRpc<void>({
			method: DataExplorerBackendRequest.SetSortColumns,
			uri: this.datasetUri,
			params: { sort_keys: sortKeys } satisfies SetSortColumnsParams
		});
	}

	async getColumnProfiles(
		callbackId: string,
		profiles: Array<ColumnProfileRequest>,
		formatOptions: FormatOptions): Promise<void> {
		return this._execRpc<void>({
			method: DataExplorerBackendRequest.GetColumnProfiles,
			uri: this.datasetUri,
			params: {
				callback_id: callbackId,
				profiles: profiles,
				format_options: formatOptions
			} satisfies GetColumnProfilesParams
		});
	}

	async openDataExplorer(): Promise<void> {
		throw new Error('openDataExplorer is not supported by the extension backend');
	}
}
