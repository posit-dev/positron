/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-sqlite's sqliteDataExplorerRpcHandler.ts;
// differs only in the provider id and in taking the column schema from the driver's
// Arrow schema rather than a vendor catalog query.

import * as positron from 'positron';
import * as vscode from 'vscode';
import { AdbcTableRef, IAdbcMetadataClient, IAdbcQueryClient } from './adbcWorkerClient.js';
import { WorkerColumnSchema } from './adbcWorkerProtocol.js';
import { adbcDisplayType, AdbcSchemaEntry, AdbcTableView } from './adbcTableView.js';
import { QuoteIdentifier } from './adbcDialect.js';
import {
	ConvertToCodeParams,
	DataExplorerBackendRequest,
	DataExplorerFrontendEvent,
	DataExplorerResponse,
	DataExplorerRpc,
	DataExplorerUiEvent,
	ExportDataSelectionParams,
	GetColumnProfilesParams,
	GetDataValuesParams,
	GetSchemaParams,
	SearchSchemaParams,
	SetRowFiltersParams,
	SetSortColumnsParams,
} from 'positron-data-explorer-protocol';

/** The provider id this extension registers its Data Explorer RPC handler under. */
export const ADBC_DATA_EXPLORER_PROVIDER_ID = 'positron-data-driver-adbc';

/**
 * The slice of the RPC handler a connection needs to preview its tables. Kept as an
 * interface so a connection can be tested without registering the real Data Explorer
 * provider.
 */
export interface IAdbcDataExplorerHost {
	/** Builds and registers a table view for a table or view under the given dataset id. */
	openTableView(datasetId: string, client: IAdbcMetadataClient, ref: AdbcTableRef, quote: QuoteIdentifier): Promise<void>;
	/** Builds and registers a single-column view of a table or view under the given dataset id. */
	openColumnView(datasetId: string, client: IAdbcMetadataClient, ref: AdbcTableRef, quote: QuoteIdentifier, columnName: string): Promise<void>;
	/** Drops a dataset's view. */
	closeTableView(datasetId: string): void;
}

/**
 * Hosts ADBC-backed Data Explorer table views and dispatches Data Explorer RPCs to them.
 *
 * A data connection node registers a table view via `openTableView` (from its preview
 * action) and then asks Positron to open an explorer keyed by the same dataset id.
 * Positron routes every RPC for that dataset to this handler (registered via
 * `positron.dataExplorer.registerRpcHandler`). Async column profiles are delivered back
 * through the registration session's `sendUiEvent`.
 */
export class AdbcDataExplorerRpcHandler implements vscode.Disposable, IAdbcDataExplorerHost {
	private readonly _views = new Map<string, AdbcTableView>();
	private readonly _session: positron.DataExplorerRpcSession;

	constructor() {
		this._session = positron.dataExplorer.registerRpcHandler(ADBC_DATA_EXPLORER_PROVIDER_ID, {
			handleRpc: (request) => this.handleRequest(request as DataExplorerRpc)
		});
	}

	dispose(): void {
		this._session.dispose();
		this._views.clear();
	}

	/**
	 * Builds and registers a table view for a table or view, replacing any prior view for
	 * the same dataset id.
	 */
	async openTableView(datasetId: string, client: IAdbcMetadataClient, ref: AdbcTableRef, quote: QuoteIdentifier): Promise<void> {
		const schema = await buildAdbcSchema(client, ref, quote);
		this._views.set(datasetId, new AdbcTableView(client, tableRef(ref, quote), ref.tableName, schema, quote));
	}

	/**
	 * Builds and registers a single-column view: an AdbcTableView whose schema is
	 * restricted to the one requested column, so the Data Explorer shows just that column.
	 */
	async openColumnView(datasetId: string, client: IAdbcMetadataClient, ref: AdbcTableRef, quote: QuoteIdentifier, columnName: string): Promise<void> {
		const schema = await buildAdbcSchema(client, ref, quote);
		const column = schema.find(c => c.column_name === columnName);
		if (!column) {
			throw new Error(`Column '${columnName}' not found in '${ref.tableName}'`);
		}
		this._views.set(datasetId, new AdbcTableView(client, tableRef(ref, quote), ref.tableName, [column], quote));
	}

	/** Drops a dataset's view, e.g. when its connection is disconnected. */
	closeTableView(datasetId: string): void {
		this._views.delete(datasetId);
	}

	async handleRequest(rpc: DataExplorerRpc): Promise<DataExplorerResponse> {
		try {
			return { result: await this._dispatch(rpc) };
		} catch (error) {
			const message = error instanceof Error ? error.message : `Unknown error handling ${rpc.method}`;
			return { error_message: message };
		}
	}

	private async _dispatch(rpc: DataExplorerRpc): Promise<unknown> {
		if (rpc.uri === undefined) {
			throw new Error(`A dataset identifier is required for ${rpc.method}`);
		}
		const view = this._views.get(rpc.uri);
		if (!view) {
			throw new Error(`No ADBC data explorer is open for ${rpc.uri}`);
		}

		switch (rpc.method) {
			case DataExplorerBackendRequest.GetState:
				return view.getState();
			case DataExplorerBackendRequest.GetSchema:
				return view.getSchema(rpc.params as GetSchemaParams);
			case DataExplorerBackendRequest.SearchSchema:
				return view.searchSchema(rpc.params as SearchSchemaParams);
			case DataExplorerBackendRequest.GetDataValues:
				return view.getDataValues(rpc.params as GetDataValuesParams);
			case DataExplorerBackendRequest.SetRowFilters:
				return view.setRowFilters(rpc.params as SetRowFiltersParams);
			case DataExplorerBackendRequest.SetSortColumns:
				return view.setSortColumns(rpc.params as SetSortColumnsParams);
			case DataExplorerBackendRequest.ExportDataSelection:
				return view.exportDataSelection(rpc.params as ExportDataSelectionParams);
			case DataExplorerBackendRequest.ConvertToCode:
				return view.convertToCode(rpc.params as ConvertToCodeParams);
			case DataExplorerBackendRequest.SuggestCodeSyntax:
				return view.suggestCodeSyntax();
			case DataExplorerBackendRequest.GetColumnProfiles:
				return this._getColumnProfiles(view, rpc.uri, rpc.params as GetColumnProfilesParams);
			default:
				throw new Error(`Unsupported data explorer method: ${rpc.method}`);
		}
	}

	/**
	 * Column profiles are computed asynchronously: acknowledge the request immediately,
	 * then push the results to the frontend via the registration session.
	 */
	private _getColumnProfiles(view: AdbcTableView, datasetId: string, params: GetColumnProfilesParams): void {
		void (async () => {
			try {
				const profiles = await view.computeColumnProfiles(params);
				this._session.sendUiEvent({
					uri: datasetId,
					method: DataExplorerFrontendEvent.ReturnColumnProfiles,
					params: profiles,
				} satisfies DataExplorerUiEvent);
			} catch (error) {
				const message = error instanceof Error ? error.message : 'unknown error';
				console.error(`Failed to compute ADBC column profiles: ${message}`);
			}
		})();
	}
}

/**
 * Builds a fully-qualified, quoted table reference (e.g. `"catalog"."schema"."table"`).
 * The catalog and schema are omitted when the driver reports them empty, which happens
 * for engines with no such level (SQLite reports an empty schema name).
 */
export function tableRef(ref: AdbcTableRef, quote: QuoteIdentifier): string {
	return [ref.catalog, ref.dbSchema, ref.tableName]
		.filter((part): part is string => part !== undefined && part.length > 0)
		.map(quote)
		.join('.');
}

/**
 * Reads a table or view's column schema and resolves each column's display type.
 *
 * The direct route is ADBC's GetTableSchema, which reports the table's Arrow schema and
 * needs no vendor catalog query. But GetTableSchema is optional in the ADBC spec and
 * genuinely unimplemented by some drivers -- the Databricks driver documents it as
 * unsupported -- so when it fails we fall back to asking the engine what a
 * matches-nothing SELECT would return. That still yields real Arrow types (so display
 * types stay accurate) and costs a query plan but no scan.
 */
export async function buildAdbcSchema(client: IAdbcMetadataClient, ref: AdbcTableRef, quote: QuoteIdentifier): Promise<AdbcSchemaEntry[]> {
	let columns: WorkerColumnSchema[] = [];
	try {
		columns = await client.getTableSchema(ref);
	} catch {
		// The driver does not implement GetTableSchema; fall through to the query probe.
	}
	if (columns.length === 0) {
		columns = await client.getQuerySchema(`SELECT * FROM ${tableRef(ref, quote)} WHERE 1 = 0`);
	}
	return columns.map(column => ({
		column_name: column.name,
		column_type: column.typeName,
		type_display: adbcDisplayType(column.typeId),
	}));
}

/** Re-exported so callers can type a bare query client without reaching into the worker module. */
export type { IAdbcQueryClient };
