/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { DataExplorerUiEvent, IDataExplorerBackendClient } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
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
	OpenDatasetParams,
	OpenDatasetResult,
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
import { ICommandService, CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { URI } from '../../../../base/common/uri.js';


/**
 * Descriptor for backend method invocation in via extension command.
 */
export interface DataExplorerRpc {
	/**
	 * Resource locator. Must be specified for all methods except for
	 * OpenDataset (which is invoked with the uri as a parameter before
	 * other methods can be invoked).
	 */
	method: DataExplorerBackendRequest;
	uri?: string;
	params: OpenDatasetParams |
	GetSchemaParams |
	SearchSchemaParams |
	GetDataValuesParams |
	GetRowLabelsParams |
	GetColumnProfilesParams |
	SetRowFiltersParams |
	SetColumnFiltersParams |
	SetSortColumnsParams |
	GetColumnProfilesParams |
	ExportDataSelectionParams |
	{};
}

/**
 * Opaque backend response containing corresponding RPC result
 * or an error message in the case of failure.
 */
export interface DataExplorerResponse {
	result?: any;
	error_message?: string;
}

export class PositronDataExplorerDuckDBBackend extends Disposable implements IDataExplorerBackendClient {
	clientId: string;

	// Events for IDataExplorerBackendClient interface
	private readonly _onDidCloseEmitter = this._register(new Emitter<void>);
	private readonly _onDidSchemaUpdateEmitter = this._register(new Emitter<SchemaUpdateEvent>);
	private readonly _onDidDataUpdateEmitter = this._register(new Emitter<DataUpdateEvent>);
	private readonly _onDidReturnColumnProfilesEmitter = this._register(
		new Emitter<ReturnColumnProfilesEvent>);

	readonly onDidClose = this._onDidCloseEmitter.event;
	readonly onDidSchemaUpdate = this._onDidSchemaUpdateEmitter.event;
	readonly onDidDataUpdate = this._onDidDataUpdateEmitter.event;
	readonly onDidReturnColumnProfiles = this._onDidReturnColumnProfilesEmitter.event;

	private readonly initialSetup: Promise<any>;

	constructor(
		private readonly _commandService: ICommandService,
		private readonly uri: URI
	) {
		super();
		this.clientId = `duckdb:${this.uri.toString()}`;
		this.initialSetup = this.openDataset();
	}

	handleUiEvent(event: DataExplorerUiEvent) {
		// Route UI event from extension to the correct emitter
		if (event.method === DataExplorerFrontendEvent.ReturnColumnProfiles) {
			this._onDidReturnColumnProfilesEmitter.fire(
				event.params as ReturnColumnProfilesEvent
			);
		} else if (event.method === DataExplorerFrontendEvent.DataUpdate) {
			this._onDidDataUpdateEmitter.fire({});
		} else if (event.method === DataExplorerFrontendEvent.SchemaUpdate) {
			this._onDidSchemaUpdateEmitter.fire(event.params as SchemaUpdateEvent);
		}
	}

	private async _execRpc<Type>(rpc: DataExplorerRpc): Promise<Type> {
		await this.initialSetup;

		const commandName = 'positron-duckdb.dataExplorerRpc';
		if (CommandsRegistry.getCommand(commandName) === undefined) {
			await (new Promise<void>((resolve, reject) => {
				// Reject if command not registered within 30 seconds
				const timeoutId = setTimeout(() => {
					reject(new Error(`${commandName} not registered within 30 seconds`));
				}, 30000);

				CommandsRegistry.onDidRegisterCommand((id: string) => {
					if (id === commandName) {
						clearTimeout(timeoutId);
						resolve();
					}
				});
			}));
		}

		const response = await this._commandService.executeCommand(commandName, rpc);

		if (response === undefined) {
			return Promise.reject(
				new Error('Sending request to positron-duckdb failed for unknown reason')
			);
		} else if ('error_message' in response) {
			return Promise.reject(new Error(response.error_message));
		} else {
			return response.result;
		}
	}

	async openDataset() {
		const result = await this._execRpc<OpenDatasetResult>({
			method: DataExplorerBackendRequest.OpenDataset,
			params: { uri: this.uri.toString() }
		});

		if (result.error_message) {
			return Promise.reject(new Error(result.error_message));
		}
	}

	async getState(): Promise<BackendState> {
		return this._execRpc<BackendState>({
			method: DataExplorerBackendRequest.GetState,
			uri: this.uri.toString(),
			params: {}
		});
	}

	async getSchema(columnIndices: Array<number>): Promise<TableSchema> {
		return this._execRpc<TableSchema>({
			method: DataExplorerBackendRequest.GetSchema,
			uri: this.uri.toString(),
			params: { column_indices: columnIndices } satisfies GetSchemaParams
		});
	}

	async searchSchema(filters: Array<ColumnFilter>, sortOrder: SearchSchemaSortOrder): Promise<SearchSchemaResult> {
		return this._execRpc<SearchSchemaResult>({
			method: DataExplorerBackendRequest.SearchSchema,
			uri: this.uri.toString(),
			params: {
				filters: filters,
				sort_order: sortOrder
			} satisfies SearchSchemaParams
		});
	}

	async getDataValues(columns: Array<ColumnSelection>, formatOptions: FormatOptions): Promise<TableData> {
		return this._execRpc<TableData>({
			method: DataExplorerBackendRequest.GetDataValues,
			uri: this.uri.toString(),
			params: {
				columns,
				format_options: formatOptions
			} satisfies GetDataValuesParams
		});
	}

	async getRowLabels(selection: ArraySelection, formatOptions: FormatOptions): Promise<TableRowLabels> {
		return this._execRpc<TableRowLabels>({
			method: DataExplorerBackendRequest.GetRowLabels,
			uri: this.uri.toString(),
			params: {
				selection,
				format_options: formatOptions
			}
		});
	}

	async exportDataSelection(selection: TableSelection, format: ExportFormat): Promise<ExportedData> {
		return this._execRpc<ExportedData>({
			method: DataExplorerBackendRequest.ExportDataSelection,
			uri: this.uri.toString(),
			params: {
				selection,
				format
			} satisfies ExportDataSelectionParams
		});
	}

	async suggestCodeSyntax(): Promise<CodeSyntaxName> {
		return this._execRpc<CodeSyntaxName>({
			method: DataExplorerBackendRequest.SuggestCodeSyntax,
			uri: this.uri.toString(),
			params: {}
		});
	}

	async convertToCode(columnFilters: Array<ColumnFilter>, rowFilters: Array<RowFilter>, sortKeys: Array<ColumnSortKey>, codeSyntax: CodeSyntaxName): Promise<ConvertedCode> {
		return this._execRpc<ConvertedCode>({
			method: DataExplorerBackendRequest.ConvertToCode,
			uri: this.uri.toString(),
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
			uri: this.uri.toString(),
			params: { filters } satisfies SetColumnFiltersParams
		});
	}

	async setRowFilters(filters: Array<RowFilter>): Promise<FilterResult> {
		return this._execRpc<FilterResult>({
			method: DataExplorerBackendRequest.SetRowFilters,
			uri: this.uri.toString(),
			params: { filters } satisfies SetRowFiltersParams
		});
	}

	async setSortColumns(sortKeys: Array<ColumnSortKey>): Promise<void> {
		return this._execRpc<void>({
			method: DataExplorerBackendRequest.SetSortColumns,
			uri: this.uri.toString(),
			params: { sort_keys: sortKeys } satisfies SetSortColumnsParams
		});
	}

	async getColumnProfiles(
		callbackId: string,
		profiles: Array<ColumnProfileRequest>,
		formatOptions: FormatOptions): Promise<void> {
		return this._execRpc<void>({
			method: DataExplorerBackendRequest.GetColumnProfiles,
			uri: this.uri.toString(),
			params: {
				callback_id: callbackId,
				profiles: profiles,
				format_options: formatOptions
			}
		});
	}
}
