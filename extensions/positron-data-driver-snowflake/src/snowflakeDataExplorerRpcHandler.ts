/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-redshift's redshiftDataExplorerRpcHandler.ts; differs in
// the provider id, the table-view type names, and that a Snowflake object is always addressed by a
// three-part `"db"."schema"."table"` reference (its database is always known).

import * as positron from 'positron';
import * as vscode from 'vscode';
import { IProfileLogger, ISnowflakeQueryClient, SnowflakeSchemaEntry, SnowflakeTableView, snowflakeDisplayType } from './snowflakeTableView.js';
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
export const SNOWFLAKE_DATA_EXPLORER_PROVIDER_ID = 'positron-data-driver-snowflake';

/**
 * The slice of the RPC handler a connection needs to preview its tables. Kept as an interface so a
 * connection can be tested without registering the real Data Explorer provider.
 */
export interface ISnowflakeDataExplorerHost {
	/** Builds and registers a table view for a table or view under the given dataset id. */
	openTableView(datasetId: string, client: ISnowflakeQueryClient, database: string, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void>;
	/** Builds and registers a single-column view of a table or view under the given dataset id. */
	openColumnView(datasetId: string, client: ISnowflakeQueryClient, database: string, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void>;
	/** Drops a dataset's view. */
	closeTableView(datasetId: string): void;
}

/**
 * Hosts Snowflake-backed Data Explorer table views and dispatches Data Explorer RPCs to them.
 *
 * A data connection node registers a table view via `openTableView` (from its preview action) and
 * then asks Positron to open an explorer keyed by the same dataset id. Positron routes every RPC
 * for that dataset to this handler (registered via `positron.dataExplorer.registerRpcHandler`).
 * Async column profiles are delivered back through the registration session's `sendUiEvent`.
 */
export class SnowflakeDataExplorerRpcHandler implements vscode.Disposable, ISnowflakeDataExplorerHost {
	private readonly _views = new Map<string, SnowflakeTableView>();
	private readonly _session: positron.DataExplorerRpcSession;

	// Per-dataset column-profile coalescing. The frontend re-requests profiles on layout churn, so we
	// run at most one pass per dataset at a time (the connection is single anyway); a newer request
	// cancels the running pass and becomes the only pending one, so intermediate requests are dropped.
	private readonly _profileCurrent = new Map<string, { isCancellationRequested: boolean }>();
	private readonly _profilePending = new Map<string, GetColumnProfilesParams>();
	private readonly _profileDraining = new Set<string>();

	/** @param _logger Optional diagnostic log sink, threaded to each table view for profile timing. */
	constructor(private readonly _logger?: IProfileLogger) {
		this._session = positron.dataExplorer.registerRpcHandler(SNOWFLAKE_DATA_EXPLORER_PROVIDER_ID, {
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
		client: ISnowflakeQueryClient,
		database: string,
		schemaName: string,
		tableName: string,
		kind: 'table' | 'view',
	): Promise<void> {
		const schema = await buildSnowflakeSchema(client, database, schemaName, tableName);
		this._views.set(datasetId, new SnowflakeTableView(client, tableRef(database, schemaName, tableName), tableName, kind, schema, this._logger));
	}

	/**
	 * Builds and registers a single-column view: a SnowflakeTableView whose schema is restricted to
	 * the one requested column, so the Data Explorer shows just that column.
	 */
	async openColumnView(
		datasetId: string,
		client: ISnowflakeQueryClient,
		database: string,
		schemaName: string,
		tableName: string,
		kind: 'table' | 'view',
		columnName: string,
	): Promise<void> {
		const schema = await buildSnowflakeSchema(client, database, schemaName, tableName);
		const column = schema.find(c => c.column_name === columnName);
		if (!column) {
			throw new Error(`Column '${columnName}' not found in '${schemaName}.${tableName}'`);
		}
		this._views.set(datasetId, new SnowflakeTableView(client, tableRef(database, schemaName, tableName), tableName, kind, [column], this._logger));
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
			throw new Error(`No Snowflake data explorer is open for ${rpc.uri}`);
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
	private _getColumnProfiles(view: SnowflakeTableView, datasetId: string, params: GetColumnProfilesParams): void {
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
	 * of a burst is fully computed; the connection never carries more than one pass's statements.
	 */
	private async _drainColumnProfiles(view: SnowflakeTableView, datasetId: string): Promise<void> {
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
						this._logger?.info(`Failed to compute column profiles for ${datasetId}: ${message}`);
						console.error(`Failed to compute Snowflake column profiles: ${message}`);
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
 * Builds a double-quote-escaped three-part `"db"."schema"."table"` table reference for use in FROM
 * clauses.
 */
function tableRef(database: string, schemaName: string, tableName: string): string {
	const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"';
	return [database, schemaName, tableName].map(quote).join('.');
}

/**
 * Reads a table or view's column schema from `"<db>".INFORMATION_SCHEMA.COLUMNS` and resolves each
 * column's display type. Names are inlined as escaped string literals; the database is a quoted
 * identifier. The numeric scale distinguishes an integer NUMBER (scale 0) from a decimal.
 */
export async function buildSnowflakeSchema(
	client: ISnowflakeQueryClient,
	database: string,
	schemaName: string,
	relationName: string,
): Promise<SnowflakeSchemaEntry[]> {
	const literal = (value: string) => `'${value.replace(/'/g, '\'\'')}'`;
	const quoteId = (name: string) => '"' + name.replace(/"/g, '""') + '"';
	const sql = `SELECT COLUMN_NAME AS "column_name", DATA_TYPE AS "data_type", NUMERIC_SCALE AS "numeric_scale" ` +
		`FROM ${quoteId(database)}.INFORMATION_SCHEMA.COLUMNS ` +
		`WHERE TABLE_SCHEMA = ${literal(schemaName)} AND TABLE_NAME = ${literal(relationName)} ` +
		`ORDER BY ORDINAL_POSITION`;
	const rows = await client.runQuery(sql);
	return rows.map(row => {
		const dataType = String(row.data_type);
		const scale = row.numeric_scale === null || row.numeric_scale === undefined ? null : Number(row.numeric_scale);
		return {
			column_name: String(row.column_name),
			column_type: dataType,
			type_display: snowflakeDisplayType(dataType, scale),
		};
	});
}
