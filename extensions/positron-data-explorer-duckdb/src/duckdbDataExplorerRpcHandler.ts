/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-sqlite's sqliteDataExplorerRpcHandler.ts; differs only
// in the provider id, the schema-qualified table reference, and the information_schema schema query.

import * as positron from 'positron';
import * as vscode from 'vscode';
import { IDuckDBQueryClient } from './duckdbWorkerClient.js';
import { DuckDBSchemaEntry, DuckDBTableView, duckdbDisplayType, IDuckDBTableCodeGenerator } from './duckdbTableView.js';
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

/** Options for {@link IDuckDBDataExplorerHost.openTableView}. */
export interface OpenTableViewOptions {
	/**
	 * The human-readable name shown in the Data Explorer tab (defaults to the table name); pass it
	 * when the physical table name is not what the user should see (e.g. a synthetic name over a
	 * downloaded file).
	 */
	displayName?: string;
	/** Overrides the view's Convert-to-Code output (see {@link IDuckDBTableCodeGenerator}). */
	codeGenerator?: IDuckDBTableCodeGenerator;
	/**
	 * Called when the Data Explorer for this dataset is closed by the user (its tab closed), so the
	 * consumer can release the dataset's resources (e.g. drop a materialized table, shut down an idle
	 * worker). Not called when the view is removed via {@link IDuckDBDataExplorerHost.closeTableView}.
	 */
	onClose?: () => void;
}

/**
 * The slice of the RPC handler a connection needs to preview its tables. Kept as an interface so a
 * connection can be tested without registering the real Data Explorer provider.
 */
export interface IDuckDBDataExplorerHost {
	/**
	 * Builds and registers a table view for a table or view under the given dataset id. See
	 * {@link OpenTableViewOptions} for the display name, Convert-to-Code override, and close hook.
	 */
	openTableView(datasetId: string, client: IDuckDBQueryClient, schemaName: string, tableName: string, kind: 'table' | 'view', options?: OpenTableViewOptions): Promise<void>;
	/** Builds and registers a single-column view of a table or view under the given dataset id. */
	openColumnView(datasetId: string, client: IDuckDBQueryClient, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void>;
	/** Drops a dataset's view (without invoking its close hook), e.g. when its connection disconnects. */
	closeTableView(datasetId: string): void;
}

/**
 * Hosts DuckDB-backed Data Explorer table views and dispatches Data Explorer RPCs to them.
 *
 * A data connection node registers a table view via `openTableView` (from its preview action) and
 * then asks Positron to open an explorer keyed by the same dataset id. Positron routes every RPC
 * for that dataset to this handler (registered via `positron.dataExplorer.registerRpcHandler`).
 * Async column profiles are delivered back through the registration session's `sendUiEvent`.
 *
 * The provider id is supplied by the consuming extension, so each data driver that reuses this
 * DuckDB backend registers under its own id (and must pass the same id to `positron.dataExplorer.open`).
 */
export class DuckDBDataExplorerRpcHandler implements vscode.Disposable, IDuckDBDataExplorerHost {
	private readonly _views = new Map<string, DuckDBTableView>();
	/** Per-dataset close hooks, invoked when the user closes a dataset's Data Explorer tab. */
	private readonly _onClose = new Map<string, () => void>();
	private readonly _session: positron.DataExplorerRpcSession;

	/**
	 * @param providerId The Data Explorer provider id to register under; the consuming extension
	 * passes the same id to `positron.dataExplorer.open`.
	 */
	constructor(providerId: string) {
		this._session = positron.dataExplorer.registerRpcHandler(providerId, {
			handleRpc: (request) => this.handleRequest(request as DataExplorerRpc),
			closeDataset: (datasetId) => this.closeDataset(datasetId),
		});
	}

	dispose(): void {
		this._session.dispose();
		this._views.clear();
		this._onClose.clear();
	}

	/**
	 * Builds and registers a table view for a table or view, replacing any prior view for the same
	 * dataset id.
	 */
	async openTableView(
		datasetId: string,
		client: IDuckDBQueryClient,
		schemaName: string,
		tableName: string,
		kind: 'table' | 'view',
		options: OpenTableViewOptions = {},
	): Promise<void> {
		const schema = await buildDuckDBSchema(client, schemaName, tableName);
		this._views.set(datasetId, new DuckDBTableView(client, tableRef(schemaName, tableName), options.displayName ?? tableName, kind, schema, options.codeGenerator));
		if (options.onClose) {
			this._onClose.set(datasetId, options.onClose);
		} else {
			this._onClose.delete(datasetId);
		}
	}

	/**
	 * Builds and registers a single-column view: a DuckDBTableView whose schema is restricted to the
	 * one requested column, so the Data Explorer shows just that column.
	 */
	async openColumnView(
		datasetId: string,
		client: IDuckDBQueryClient,
		schemaName: string,
		tableName: string,
		kind: 'table' | 'view',
		columnName: string,
	): Promise<void> {
		const schema = await buildDuckDBSchema(client, schemaName, tableName);
		const column = schema.find(c => c.column_name === columnName);
		if (!column) {
			throw new Error(`Column '${columnName}' not found in '${schemaName}.${tableName}'`);
		}
		this._views.set(datasetId, new DuckDBTableView(client, tableRef(schemaName, tableName), tableName, kind, [column]));
	}

	/**
	 * Drops a dataset's view and forgets its close hook, without invoking it. Used when the connection
	 * tears everything down itself (disconnect), where invoking the per-dataset hook would double up on
	 * that wholesale cleanup.
	 */
	closeTableView(datasetId: string): void {
		this._views.delete(datasetId);
		this._onClose.delete(datasetId);
	}

	/**
	 * Handles the user closing a dataset's Data Explorer tab (invoked by Positron via the registered
	 * handler's `closeDataset`): drops the view and invokes the consumer's close hook (if any) so it can
	 * release that dataset's resources.
	 */
	closeDataset(datasetId: string): void {
		this._views.delete(datasetId);
		const onClose = this._onClose.get(datasetId);
		this._onClose.delete(datasetId);
		onClose?.();
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
			throw new Error(`No DuckDB data explorer is open for ${rpc.uri}`);
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
	 * the results to the frontend via the registration session.
	 */
	private _getColumnProfiles(view: DuckDBTableView, datasetId: string, params: GetColumnProfilesParams): void {
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
				console.error(`Failed to compute DuckDB column profiles: ${message}`);
			}
		})();
	}
}

/** Builds a schema-qualified, double-quote-escaped table reference (e.g. `"main"."t"`). */
function tableRef(schemaName: string, tableName: string): string {
	const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"';
	return `${quote(schemaName)}.${quote(tableName)}`;
}

/**
 * Reads a table or view's column schema via information_schema.columns and resolves each column's
 * display type.
 */
export async function buildDuckDBSchema(
	client: IDuckDBQueryClient,
	schemaName: string,
	relationName: string,
): Promise<DuckDBSchemaEntry[]> {
	const rows = await client.runQuery(
		`SELECT column_name, data_type FROM information_schema.columns ` +
		`WHERE table_catalog = current_database() AND table_schema = $schema ` +
		`AND table_name = $relation ORDER BY ordinal_position`,
		{ schema: schemaName, relation: relationName }
	);
	return rows.map(row => {
		const dataType = String(row.data_type);
		return {
			column_name: String(row.column_name),
			column_type: dataType,
			type_display: duckdbDisplayType(dataType),
		};
	});
}
