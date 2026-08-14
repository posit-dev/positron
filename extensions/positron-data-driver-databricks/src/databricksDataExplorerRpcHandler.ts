/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-snowflake's snowflakeDataExplorerRpcHandler.ts; differs
// in the provider id, the table-view type names, and that a Databricks object is always addressed by
// a three-part `` `catalog`.`schema`.`table` `` reference (its catalog is always known).

import * as positron from 'positron';
import * as vscode from 'vscode';
import { IDatabricksQueryClient, DatabricksSchemaEntry, DatabricksTableView } from './databricksTableView.js';
import { databricksDisplayType, describeTableSql, parseDescribeRows, tableRef } from './databricksSql.js';
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
export const DATABRICKS_DATA_EXPLORER_PROVIDER_ID = 'positron-data-driver-databricks';

/**
 * The slice of the RPC handler a connection needs to preview its tables. Kept as an interface so a
 * connection can be tested without registering the real Data Explorer provider.
 */
export interface IDatabricksDataExplorerHost {
	/** Builds and registers a table view for a table or view under the given dataset id. */
	openTableView(datasetId: string, client: IDatabricksQueryClient, catalog: string, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void>;
	/** Builds and registers a single-column view of a table or view under the given dataset id. */
	openColumnView(datasetId: string, client: IDatabricksQueryClient, catalog: string, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void>;
	/** Drops a dataset's view. */
	closeTableView(datasetId: string): void;
}

/**
 * Hosts Databricks-backed Data Explorer table views and dispatches Data Explorer RPCs to them.
 *
 * A data connection node registers a table view via `openTableView` (from its preview action) and
 * then asks Positron to open an explorer keyed by the same dataset id. Positron routes every RPC
 * for that dataset to this handler (registered via `positron.dataExplorer.registerRpcHandler`).
 * Async column profiles are delivered back through the registration session's `sendUiEvent`.
 */
export class DatabricksDataExplorerRpcHandler implements vscode.Disposable, IDatabricksDataExplorerHost {
	private readonly _views = new Map<string, DatabricksTableView>();
	private readonly _session: positron.DataExplorerRpcSession;

	// Per-dataset column-profile coalescing. The frontend re-requests profiles on layout churn, so we
	// run at most one pass per dataset at a time (the session is single anyway); a newer request
	// cancels the running pass and becomes the only pending one, so intermediate requests are dropped.
	private readonly _profileCurrent = new Map<string, { isCancellationRequested: boolean }>();
	private readonly _profilePending = new Map<string, GetColumnProfilesParams>();
	private readonly _profileDraining = new Set<string>();

	/** @param _logger Optional diagnostic log sink, threaded to each table view for profile timing. */
	constructor(private readonly _logger?: positron.DataConnectionLogger) {
		this._session = positron.dataExplorer.registerRpcHandler(DATABRICKS_DATA_EXPLORER_PROVIDER_ID, {
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
		client: IDatabricksQueryClient,
		catalog: string,
		schemaName: string,
		tableName: string,
		kind: 'table' | 'view',
	): Promise<void> {
		const ref = tableRef(catalog, schemaName, tableName);
		const schema = await buildDatabricksSchema(client, ref);
		this._views.set(datasetId, new DatabricksTableView(client, ref, tableName, kind, schema, this._logger));
	}

	/**
	 * Builds and registers a single-column view: a DatabricksTableView whose schema is restricted to
	 * the one requested column, so the Data Explorer shows just that column.
	 */
	async openColumnView(
		datasetId: string,
		client: IDatabricksQueryClient,
		catalog: string,
		schemaName: string,
		tableName: string,
		kind: 'table' | 'view',
		columnName: string,
	): Promise<void> {
		const ref = tableRef(catalog, schemaName, tableName);
		const schema = await buildDatabricksSchema(client, ref);
		const column = schema.find(c => c.column_name === columnName);
		if (!column) {
			throw new Error(`Column '${columnName}' not found in '${schemaName}.${tableName}'`);
		}
		this._views.set(datasetId, new DatabricksTableView(client, ref, tableName, kind, [column], this._logger));
	}

	/** Drops a dataset's view, e.g. when its connection is disconnected. */
	closeTableView(datasetId: string): void {
		this._views.delete(datasetId);
		// Abandon any in-flight or pending profile pass for the dataset.
		const current = this._profileCurrent.get(datasetId);
		if (current) {
			current.isCancellationRequested = true;
		}
		this._profilePending.delete(datasetId);
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
			throw new Error(`No Databricks data explorer is open for ${rpc.uri}`);
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
	 * Column profiles are computed asynchronously: acknowledge the request immediately, record it as
	 * the dataset's latest pending pass (cancelling any running one), and let the drain loop compute it
	 * and push the results to the frontend via the registration session.
	 */
	private _getColumnProfiles(view: DatabricksTableView, datasetId: string, params: GetColumnProfilesParams): void {
		this._profilePending.set(datasetId, params);
		// Supersede a running pass so it abandons itself at the next statement boundary.
		const current = this._profileCurrent.get(datasetId);
		if (current) {
			current.isCancellationRequested = true;
		}
		if (!this._profileDraining.has(datasetId)) {
			void this._drainColumnProfiles(view, datasetId);
		}
	}

	/**
	 * Runs the dataset's pending profile passes one at a time until none remain. Because a newer
	 * request overwrites the single pending slot and cancels the running pass, only the latest request
	 * of a burst is fully computed; the session never carries more than one pass's statements.
	 */
	private async _drainColumnProfiles(view: DatabricksTableView, datasetId: string): Promise<void> {
		this._profileDraining.add(datasetId);
		try {
			let params: GetColumnProfilesParams | undefined;
			while ((params = this._profilePending.get(datasetId)) !== undefined) {
				this._profilePending.delete(datasetId);
				const token = { isCancellationRequested: false };
				this._profileCurrent.set(datasetId, token);
				try {
					const profiles = await view.computeColumnProfiles(params, token);
					// A superseded pass returns empty; the newer pending pass will answer instead.
					if (!token.isCancellationRequested) {
						this._session.sendUiEvent({
							uri: datasetId,
							method: DataExplorerFrontendEvent.ReturnColumnProfiles,
							params: profiles,
						} satisfies DataExplorerUiEvent);
					}
				} catch (error) {
					if (!token.isCancellationRequested) {
						const message = error instanceof Error ? error.message : 'unknown error';
						this._logger?.error(`Failed to compute column profiles for ${datasetId}: ${message}`);
					}
				}
			}
		} finally {
			this._profileCurrent.delete(datasetId);
			this._profileDraining.delete(datasetId);
		}
	}
}

/**
 * Reads a table or view's column schema via `DESCRIBE TABLE` and resolves each column's display type.
 * DESCRIBE is used rather than `information_schema.columns` because the latter exists only under
 * Unity Catalog, while `hive_metastore` relations are still browsable (see databricksSql.ts).
 */
export async function buildDatabricksSchema(
	client: IDatabricksQueryClient,
	ref: string,
): Promise<DatabricksSchemaEntry[]> {
	const rows = await client.runQuery(describeTableSql(ref));
	return parseDescribeRows(rows).map(column => ({
		column_name: column.name,
		column_type: column.dataType,
		type_display: databricksDisplayType(column.dataType),
	}));
}
