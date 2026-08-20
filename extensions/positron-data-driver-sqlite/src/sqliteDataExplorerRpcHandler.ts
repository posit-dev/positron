/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { ISqliteQueryClient } from './sqliteWorkerClient.js';
import { SqliteSchemaEntry, SqliteTableView, quoteIdentifier, sqliteDisplayType } from './sqliteTableView.js';
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
export const SQLITE_DATA_EXPLORER_PROVIDER_ID = 'positron-data-driver-sqlite';

/**
 * The slice of the RPC handler a connection needs to preview its tables. Kept as an interface so a
 * connection can be tested without registering the real Data Explorer provider.
 */
export interface ISqliteDataExplorerHost {
	/** Builds and registers a table view for a table or view under the given dataset id. */
	openTableView(datasetId: string, client: ISqliteQueryClient, tableName: string, kind: 'table' | 'view'): Promise<void>;
	/** Builds and registers a single-column view of a table or view under the given dataset id. */
	openColumnView(datasetId: string, client: ISqliteQueryClient, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void>;
	/** Drops a dataset's view. */
	closeTableView(datasetId: string): void;
}

/**
 * Hosts SQLite-backed Data Explorer table views and dispatches Data Explorer RPCs to them.
 *
 * A data connection node registers a table view via `openTableView` (from its preview action) and
 * then asks Positron to open an explorer keyed by the same dataset id. Positron routes every RPC
 * for that dataset to this handler (registered via `positron.dataExplorer.registerRpcHandler`).
 * Async column profiles are delivered back through the registration session's `sendUiEvent`.
 */
export class SqliteDataExplorerRpcHandler implements vscode.Disposable, ISqliteDataExplorerHost {
	private readonly _views = new Map<string, SqliteTableView>();
	private readonly _session: positron.DataExplorerRpcSession;

	constructor(private readonly _logger?: positron.DataConnectionLogger) {
		this._session = positron.dataExplorer.registerRpcHandler(SQLITE_DATA_EXPLORER_PROVIDER_ID, {
			handleRpc: (request) => this.handleRequest(request as DataExplorerRpc)
		});
	}

	dispose(): void {
		this._session.dispose();
		this._views.clear();
	}

	/**
	 * Builds and registers a table view for a table or view, replacing any prior view for the same
	 * dataset id. Returns the dataset id (the caller passes it to the open command).
	 */
	async openTableView(
		datasetId: string,
		client: ISqliteQueryClient,
		tableName: string,
		kind: 'table' | 'view',
	): Promise<void> {
		const [schema, rowIdentity] = await Promise.all([
			buildSqliteSchema(client, tableName),
			resolveSqliteRowIdentity(client, tableName, kind),
		]);
		this._views.set(datasetId, new SqliteTableView(client, tableName, kind, schema, rowIdentity));
	}

	/**
	 * Builds and registers a single-column view: a SqliteTableView whose schema is restricted to the
	 * one requested column, so the Data Explorer shows just that column (SELECT "col" FROM "table").
	 */
	async openColumnView(
		datasetId: string,
		client: ISqliteQueryClient,
		tableName: string,
		kind: 'table' | 'view',
		columnName: string,
	): Promise<void> {
		const [schema, rowIdentity] = await Promise.all([
			buildSqliteSchema(client, tableName),
			resolveSqliteRowIdentity(client, tableName, kind),
		]);
		const column = schema.find(c => c.column_name === columnName);
		if (!column) {
			throw new Error(`Column '${columnName}' not found in '${tableName}'`);
		}
		this._views.set(datasetId, new SqliteTableView(client, tableName, kind, [column], rowIdentity));
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
			throw new Error(`No SQLite data explorer is open for ${rpc.uri}`);
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
	private _getColumnProfiles(view: SqliteTableView, datasetId: string, params: GetColumnProfilesParams): void {
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
				this._logger?.error(`Failed to compute SQLite column profiles: ${message}`);
			}
		})();
	}
}

/**
 * Reads a table or view's column schema via PRAGMA table_info and resolves each column's display
 * type. PRAGMA does not support bound parameters, so the name is double-quote escaped inline.
 */
/**
 * Resolves the ORDER BY expression that uniquely identifies a row, used as the pagination
 * tiebreaker.
 *
 * An ordinary table uses `rowid`, which matches SQLite's own storage order and so costs nothing to
 * sort by. A WITHOUT ROWID table has no `rowid` column -- ordering by it fails outright with "no
 * such column: rowid" -- but such a table is required to have a primary key, whose columns identify
 * a row just as well. Views have no row identity, so they get no tiebreaker.
 */
export async function resolveSqliteRowIdentity(
	client: ISqliteQueryClient,
	tableName: string,
	kind: 'table' | 'view',
): Promise<string | undefined> {
	if (kind !== 'table') {
		return undefined;
	}

	const created = await client.runQuery(
		`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
		[tableName]
	);
	if (!/WITHOUT\s+ROWID/i.test(String(created[0]?.sql ?? ''))) {
		return 'rowid';
	}

	// PRAGMA table_info reports `pk` as the 1-based position within the primary key, or 0 if the
	// column is not part of it. PRAGMA does not support bound parameters, so the name is
	// double-quote escaped inline.
	const safeName = tableName.replace(/"/g, '""');
	const columns = await client.runQuery(`PRAGMA table_info("${safeName}")`);
	const keyColumns = columns
		.filter(row => Number(row.pk ?? 0) > 0)
		.sort((a, b) => Number(a.pk) - Number(b.pk))
		.map(row => quoteIdentifier(String(row.name)));

	// A WITHOUT ROWID table always has a primary key, but fall back to no tiebreaker rather than
	// emitting an empty expression if the catalog ever says otherwise.
	return keyColumns.length > 0 ? keyColumns.join(', ') : undefined;
}

export async function buildSqliteSchema(
	client: ISqliteQueryClient,
	tableName: string,
): Promise<SqliteSchemaEntry[]> {
	const safeName = tableName.replace(/"/g, '""');
	const rows = await client.runQuery(`PRAGMA table_info("${safeName}")`);
	return rows.map(row => {
		const declaredType = row.type ? String(row.type) : '';
		return {
			column_name: String(row.name),
			column_type: declaredType,
			type_display: sqliteDisplayType(declaredType),
		};
	});
}
