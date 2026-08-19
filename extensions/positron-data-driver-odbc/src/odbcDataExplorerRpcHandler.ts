/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-sqlite's sqliteDataExplorerRpcHandler.ts; differs only
// in how the column schema is read (SQLColumns rather than a PRAGMA) and in threading the dialect
// through to the table view.

import * as positron from 'positron';
import * as vscode from 'vscode';
import { OdbcDialect } from './odbcDatabases';
import { OdbcTableRef } from './odbcNodes';
import { IOdbcQueryClient } from './odbcWorkerClient';
import { odbcDisplayType, OdbcSchemaEntry, OdbcTableView } from './odbcTableView';
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
export const ODBC_DATA_EXPLORER_PROVIDER_ID = 'positron-data-driver-odbc';

/**
 * The slice of the RPC handler a connection needs to preview its tables. Kept as an interface so a
 * connection can be tested without registering the real Data Explorer provider.
 */
export interface IOdbcDataExplorerHost {
	/** Builds and registers a table view for a table or view under the given dataset id. */
	openTableView(datasetId: string, client: IOdbcQueryClient, ref: OdbcTableRef, dialect: OdbcDialect): Promise<void>;
	/** Builds and registers a single-column view of a table or view under the given dataset id. */
	openColumnView(datasetId: string, client: IOdbcQueryClient, ref: OdbcTableRef, dialect: OdbcDialect, columnName: string): Promise<void>;
	/** Drops a dataset's view. */
	closeTableView(datasetId: string): void;
}

/**
 * Hosts ODBC-backed Data Explorer table views and dispatches Data Explorer RPCs to them.
 *
 * A data connection node registers a table view via `openTableView` (from its preview action) and
 * then asks Positron to open an explorer keyed by the same dataset id. Positron routes every RPC
 * for that dataset to this handler (registered via `positron.dataExplorer.registerRpcHandler`).
 * Async column profiles are delivered back through the registration session's `sendUiEvent`.
 */
export class OdbcDataExplorerRpcHandler implements vscode.Disposable, IOdbcDataExplorerHost {
	private readonly _views = new Map<string, OdbcTableView>();
	private readonly _session: positron.DataExplorerRpcSession;

	constructor(private readonly _logger?: positron.DataConnectionLogger) {
		this._session = positron.dataExplorer.registerRpcHandler(ODBC_DATA_EXPLORER_PROVIDER_ID, {
			handleRpc: (request) => this.handleRequest(request as DataExplorerRpc)
		});
	}

	dispose(): void {
		this._session.dispose();
		this._views.clear();
	}

	/**
	 * Builds and registers a table view for a table or view, replacing any prior view for the same
	 * dataset id.
	 */
	async openTableView(
		datasetId: string,
		client: IOdbcQueryClient,
		ref: OdbcTableRef,
		dialect: OdbcDialect,
	): Promise<void> {
		const schema = await buildOdbcSchema(client, ref);
		this._views.set(datasetId, new OdbcTableView(client, ref, dialect, schema));
	}

	/**
	 * Builds and registers a single-column view: an OdbcTableView whose schema is restricted to the
	 * one requested column, so the Data Explorer shows just that column.
	 */
	async openColumnView(
		datasetId: string,
		client: IOdbcQueryClient,
		ref: OdbcTableRef,
		dialect: OdbcDialect,
		columnName: string,
	): Promise<void> {
		const schema = await buildOdbcSchema(client, ref);
		const column = schema.find(c => c.column_name === columnName);
		if (!column) {
			throw new Error(`Column '${columnName}' not found in '${ref.name}'`);
		}
		this._views.set(datasetId, new OdbcTableView(client, ref, dialect, [column]));
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
			throw new Error(`No ODBC data explorer is open for ${rpc.uri}`);
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
	 * Column profiles are computed asynchronously: acknowledge the request immediately, then push
	 * the results to the frontend via the shared sendUiEvent command.
	 */
	private _getColumnProfiles(view: OdbcTableView, datasetId: string, params: GetColumnProfilesParams): void {
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
				this._logger?.error(`Failed to compute ODBC column profiles: ${message}`);
			}
		})();
	}
}

/**
 * Reads a table or view's column schema via SQLColumns, resolving each column's display type from
 * the ODBC SQL type code. Columns come back in ordinal position, which is the order the Data
 * Explorer shows them in.
 */
export async function buildOdbcSchema(
	client: IOdbcQueryClient,
	ref: OdbcTableRef,
): Promise<OdbcSchemaEntry[]> {
	const rows = await client.columns(ref.catalog ?? null, ref.schema ?? null, ref.name, null);
	return rows
		.map(row => {
			const typeName = String(row['TYPE_NAME'] ?? '');
			const dataType = typeof row['DATA_TYPE'] === 'number' ? row['DATA_TYPE'] : Number(row['DATA_TYPE']);
			return {
				column_name: String(row['COLUMN_NAME'] ?? ''),
				column_type: typeName,
				type_display: odbcDisplayType(Number.isFinite(dataType) ? dataType : undefined, typeName),
				ordinal: Number(row['ORDINAL_POSITION'] ?? 0),
			};
		})
		.filter(entry => entry.column_name.length > 0)
		.sort((a, b) => a.ordinal - b.ordinal)
		.map(({ column_name, column_type, type_display }) => ({ column_name, column_type, type_display }));
}
