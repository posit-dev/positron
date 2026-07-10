/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-postgresql's postgresqlDataExplorerRpcHandler.ts; differs
// only in the provider id and the naming of the table-view types.

import * as positron from 'positron';
import * as vscode from 'vscode';
import { IProfileLogger, IRedshiftQueryClient, RedshiftSchemaEntry, RedshiftTableView, redshiftDisplayType } from './redshiftTableView.js';
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
export const REDSHIFT_DATA_EXPLORER_PROVIDER_ID = 'positron-data-driver-redshift';

/**
 * The slice of the RPC handler a connection needs to preview its tables. Kept as an interface so a
 * connection can be tested without registering the real Data Explorer provider.
 */
export interface IRedshiftDataExplorerHost {
	/** Builds and registers a table view for a table or view under the given dataset id. */
	openTableView(datasetId: string, client: IRedshiftQueryClient, database: string | undefined, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void>;
	/** Builds and registers a single-column view of a table or view under the given dataset id. */
	openColumnView(datasetId: string, client: IRedshiftQueryClient, database: string | undefined, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void>;
	/** Drops a dataset's view. */
	closeTableView(datasetId: string): void;
}

/**
 * Hosts Redshift-backed Data Explorer table views and dispatches Data Explorer RPCs to them.
 *
 * A data connection node registers a table view via `openTableView` (from its preview action) and
 * then asks Positron to open an explorer keyed by the same dataset id. Positron routes every RPC
 * for that dataset to this handler (registered via `positron.dataExplorer.registerRpcHandler`).
 * Async column profiles are delivered back through the registration session's `sendUiEvent`.
 */
export class RedshiftDataExplorerRpcHandler implements vscode.Disposable, IRedshiftDataExplorerHost {
	private readonly _views = new Map<string, RedshiftTableView>();
	private readonly _session: positron.DataExplorerRpcSession;

	// Per-dataset column-profile coalescing. The frontend re-requests profiles on layout churn, so we
	// run at most one pass per dataset at a time (the connection is single anyway); a newer request
	// cancels the running pass and becomes the only pending one, so intermediate requests are dropped.
	private readonly _profileCurrent = new Map<string, { isCancellationRequested: boolean }>();
	private readonly _profilePending = new Map<string, GetColumnProfilesParams>();
	private readonly _profileDraining = new Set<string>();

	/** @param _logger Optional diagnostic log sink, threaded to each table view for profile timing. */
	constructor(private readonly _logger?: IProfileLogger) {
		this._session = positron.dataExplorer.registerRpcHandler(REDSHIFT_DATA_EXPLORER_PROVIDER_ID, {
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
		client: IRedshiftQueryClient,
		database: string | undefined,
		schemaName: string,
		tableName: string,
		kind: 'table' | 'view',
	): Promise<void> {
		const schema = await buildRedshiftSchema(client, database, schemaName, tableName);
		this._views.set(datasetId, new RedshiftTableView(client, tableRef(database, schemaName, tableName), tableName, kind, schema, this._logger));
	}

	/**
	 * Builds and registers a single-column view: a RedshiftTableView whose schema is restricted to
	 * the one requested column, so the Data Explorer shows just that column.
	 */
	async openColumnView(
		datasetId: string,
		client: IRedshiftQueryClient,
		database: string | undefined,
		schemaName: string,
		tableName: string,
		kind: 'table' | 'view',
		columnName: string,
	): Promise<void> {
		const schema = await buildRedshiftSchema(client, database, schemaName, tableName);
		const column = schema.find(c => c.column_name === columnName);
		if (!column) {
			throw new Error(`Column '${columnName}' not found in '${schemaName}.${tableName}'`);
		}
		this._views.set(datasetId, new RedshiftTableView(client, tableRef(database, schemaName, tableName), tableName, kind, [column], this._logger));
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
			throw new Error(`No Redshift data explorer is open for ${rpc.uri}`);
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
	private _getColumnProfiles(view: RedshiftTableView, datasetId: string, params: GetColumnProfilesParams): void {
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
	private async _drainColumnProfiles(view: RedshiftTableView, datasetId: string): Promise<void> {
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
						console.error(`Failed to compute Redshift column profiles: ${message}`);
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
 * Builds a double-quote-escaped table reference. A defined `database` produces a three-part
 * `"db"."schema"."table"` reference for cross-database queries; otherwise a two-part
 * `"schema"."table"` reference against the connected database.
 */
function tableRef(database: string | undefined, schemaName: string, tableName: string): string {
	const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"';
	const parts = database === undefined ? [schemaName, tableName] : [database, schemaName, tableName];
	return parts.map(quote).join('.');
}

/**
 * Reads a table or view's column schema and resolves each column's display type. When `database` is
 * undefined the columns come from information_schema.columns (connected database); otherwise from the
 * cross-database SVV_ALL_COLUMNS view filtered by database. Names are inlined as escaped string
 * literals.
 */
export async function buildRedshiftSchema(
	client: IRedshiftQueryClient,
	database: string | undefined,
	schemaName: string,
	relationName: string,
): Promise<RedshiftSchemaEntry[]> {
	const literal = (value: string) => `'${value.replace(/'/g, '\'\'')}'`;
	const sql = database === undefined
		? `SELECT column_name, data_type FROM information_schema.columns ` +
		`WHERE table_schema = ${literal(schemaName)} AND table_name = ${literal(relationName)} ` +
		`ORDER BY ordinal_position`
		: `SELECT column_name, data_type FROM SVV_ALL_COLUMNS ` +
		`WHERE database_name = ${literal(database)} AND schema_name = ${literal(schemaName)} AND table_name = ${literal(relationName)} ` +
		`ORDER BY ordinal_position`;
	const rows = await client.runQuery(sql);
	return rows.map(row => {
		const dataType = String(row.data_type);
		return {
			column_name: String(row.column_name),
			column_type: dataType,
			type_display: redshiftDisplayType(dataType),
		};
	});
}
