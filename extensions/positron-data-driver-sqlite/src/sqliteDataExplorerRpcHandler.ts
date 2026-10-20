/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { createSqliteReadPlan } from './sqliteReadPlan.js';
import { quoteIdentifier } from './sqliteSql.js';
import { ISqliteQueryClient } from './sqliteWorkerClient.js';
import { SqliteSchemaEntry, SqliteTableView, sqliteDisplayType } from './sqliteTableView.js';
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
	/** How each open dataset's view was built, so that refreshDataset can build it again. */
	private readonly _builders = new Map<string, ViewBuilder>();
	private readonly _session: positron.DataExplorerRpcSession;

	/**
	 * @param _logger Optional diagnostic log sink.
	 * @param registerRpcHandler Registers the handler with Positron. Tests pass a fake so they can drive
	 * the registered hooks without replacing the running extension's provider.
	 */
	constructor(
		private readonly _logger?: positron.DataConnectionLogger,
		registerRpcHandler: typeof positron.dataExplorer.registerRpcHandler = positron.dataExplorer.registerRpcHandler,
	) {
		this._session = registerRpcHandler(SQLITE_DATA_EXPLORER_PROVIDER_ID, {
			handleRpc: (request) => this.handleRequest(request as DataExplorerRpc),
			// Without this, closing a tab leaves its view registered and its snapshot in the `temp`
			// schema until the connection disconnects or the same dataset is reopened. That was a
			// bounded waste when a view held nothing but state; now it holds a copy of the relation.
			closeDataset: (datasetId) => this.closeTableView(datasetId),
			refreshDataset: (datasetId) => this.refreshDataset(datasetId),
		});
	}

	dispose(): void {
		this._session.dispose();
		for (const datasetId of [...this._views.keys()]) {
			this.closeTableView(datasetId);
		}
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
		await this._openView(datasetId, async () => {
			// Sequenced, not concurrent: a plan that has already taken a snapshot has nothing to dispose
			// it if the schema query then fails, so nothing is created until the schema is in hand.
			const schema = await buildSqliteSchema(client, tableName);
			const readPlan = await createSqliteReadPlan(
				client, tableName, kind, schema.map(c => c.column_name));
			return new SqliteTableView(client, tableName, readPlan, schema);
		});
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
		await this._openView(datasetId, async () => {
			const schema = await buildSqliteSchema(client, tableName);
			const column = schema.find(c => c.column_name === columnName);
			if (!column) {
				throw new Error(`Column '${columnName}' not found in '${tableName}'`);
			}
			// The plan is given every column the relation has, not just the requested one: what it
			// needs to know is whether the relation shadows a rowid alias, which the restricted schema
			// would hide.
			const readPlan = await createSqliteReadPlan(
				client, tableName, kind, schema.map(c => c.column_name));
			return new SqliteTableView(client, tableName, readPlan, [column]);
		});
	}

	/**
	 * Rebuilds a dataset's view from its table, so that it shows changes made to the table since the
	 * view was built. The rebuilt view replaces the old one only once it has read its row count, so a
	 * rebuild that fails -- the table was dropped, the connection is down -- leaves the old view in
	 * place. The rebuilt view has no sort keys or row filters; Positron re-applies them.
	 */
	async refreshDataset(datasetId: string): Promise<void> {
		const builder = this._builders.get(datasetId);
		if (!builder) {
			throw new Error(`No SQLite data explorer is open for ${datasetId}`);
		}

		const generation = ++builder.generation;
		const view = await builder.build();
		try {
			await validateRebuiltView(view);
			// The dataset may have closed, been reopened, or been refreshed again while this view was
			// being built. Installing it then would resurrect a closed dataset or replace a newer view.
			if (this._builders.get(datasetId) !== builder || builder.generation !== generation) {
				throw new Error(vscode.l10n.t('The data explorer closed or was refreshed again before the refresh finished.'));
			}
		} catch (error) {
			void view.dispose().catch(() => { });
			throw error;
		}

		const previous = this._views.get(datasetId);
		this._views.set(datasetId, view);
		void previous?.dispose().catch(() => { });
	}

	/**
	 * Builds a dataset's view and registers it, remembering how it was built so that it can be
	 * refreshed, and disposing any view the same dataset id already had so that reopening a dataset
	 * does not leave its predecessor's snapshot behind.
	 */
	private async _openView(datasetId: string, build: () => Promise<SqliteTableView>): Promise<void> {
		const view = await build();
		this.closeTableView(datasetId);
		this._views.set(datasetId, view);
		this._builders.set(datasetId, { build, generation: 0 });
	}

	/** Drops a dataset's view, e.g. when its connection is disconnected. */
	closeTableView(datasetId: string): void {
		const view = this._views.get(datasetId);
		this._views.delete(datasetId);
		this._builders.delete(datasetId);
		// Dropping the snapshot is best-effort cleanup of a private temp table, so nothing waits on
		// it and a failure (typically a worker that is already gone) must not surface to the caller.
		void view?.dispose().catch(() => { });
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

/** How a dataset's view is built, and how many times it has been rebuilt. */
interface ViewBuilder {
	readonly build: () => Promise<SqliteTableView>;
	generation: number;
}

/**
 * Checks that a rebuilt view can be shown before it replaces the old one: that its relation still
 * has columns (PRAGMA table_info reports none for a relation that no longer exists) and that its
 * row count can be read.
 */
async function validateRebuiltView(view: SqliteTableView): Promise<void> {
	const state = await view.getState();
	if (state.table_unfiltered_shape.num_columns === 0) {
		throw new Error(vscode.l10n.t("'{0}' has no columns. It may have been dropped or renamed.", state.display_name));
	}
}

/**
 * Reads a table or view's column schema via PRAGMA table_info and resolves each column's display
 * type. PRAGMA does not support bound parameters, so the name is double-quote escaped inline.
 */
export async function buildSqliteSchema(
	client: ISqliteQueryClient,
	tableName: string,
): Promise<SqliteSchemaEntry[]> {
	const rows = await client.runQuery(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
	return rows.map(row => {
		const declaredType = row.type ? String(row.type) : '';
		return {
			column_name: String(row.name),
			column_type: declaredType,
			type_display: sqliteDisplayType(declaredType),
		};
	});
}
