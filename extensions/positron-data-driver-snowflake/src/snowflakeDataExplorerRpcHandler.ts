/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-redshift's redshiftDataExplorerRpcHandler.ts; differs in
// the provider id, the table-view type names, and that a Snowflake object is always addressed by a
// three-part `"db"."schema"."table"` reference (its database is always known).

import * as positron from 'positron';
import * as vscode from 'vscode';
import { ISnowflakeQueryClient, SnowflakeSchemaEntry, SnowflakeTableView, snowflakeDisplayType } from './snowflakeTableView.js';
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
	/** How each open dataset's view was built, so that refreshDataset can build it again. */
	private readonly _builders = new Map<string, ViewBuilder>();
	private readonly _session: positron.DataExplorerRpcSession;

	// Per-dataset column-profile coalescing. The frontend re-requests profiles on layout churn, so we
	// run at most one pass per dataset at a time (the connection is single anyway); a newer request
	// cancels the running pass and becomes the only pending one, so intermediate requests are dropped.
	private readonly _profileCurrent = new Map<string, { isCancellationRequested: boolean }>();
	private readonly _profilePending = new Map<string, GetColumnProfilesParams>();
	private readonly _profileDraining = new Set<string>();

	/**
	 * @param _logger Optional diagnostic log sink, threaded to each table view for profile timing.
	 * @param registerRpcHandler Registers the handler with Positron. Tests pass a fake so they can drive
	 * the registered hooks without replacing the running extension's provider.
	 */
	constructor(
		private readonly _logger?: positron.DataConnectionLogger,
		registerRpcHandler: typeof positron.dataExplorer.registerRpcHandler = positron.dataExplorer.registerRpcHandler,
	) {
		this._session = registerRpcHandler(SNOWFLAKE_DATA_EXPLORER_PROVIDER_ID, {
			handleRpc: request => this.handleRequest(request as DataExplorerRpc),
			closeDataset: datasetId => this.closeTableView(datasetId),
			refreshDataset: datasetId => this.refreshDataset(datasetId),
		});
	}

	dispose(): void {
		this._session.dispose();
		this._views.clear();
		this._builders.clear();
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
		await this._openView(datasetId, async () => {
			const schema = await buildSnowflakeSchema(client, database, schemaName, tableName);
			// INFORMATION_SCHEMA returns no columns, rather than an error, for a table or view that was
			// dropped or renamed since the tree listed it. None can have zero columns, so fail here and
			// the open reports it instead of showing an empty grid.
			if (schema.length === 0) {
				throw new Error(vscode.l10n.t("'{0}' does not exist or is not authorized.", `${schemaName}.${tableName}`));
			}
			return new SnowflakeTableView(client, tableRef(database, schemaName, tableName), tableName, kind, schema, this._logger);
		});
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
		await this._openView(datasetId, async () => {
			const schema = await buildSnowflakeSchema(client, database, schemaName, tableName);
			const column = schema.find(c => c.column_name === columnName);
			if (!column) {
				throw new Error(`Column '${columnName}' not found in '${schemaName}.${tableName}'`);
			}
			return new SnowflakeTableView(client, tableRef(database, schemaName, tableName), tableName, kind, [column], this._logger);
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
			throw new Error(`No Snowflake data explorer is open for ${datasetId}`);
		}

		const generation = ++builder.generation;
		const view = await builder.build();
		await validateRebuiltView(view);

		// The dataset may have closed, been reopened, or been refreshed again while this view was
		// being built. Installing it then would resurrect a closed dataset or replace a newer view.
		if (this._builders.get(datasetId) !== builder || builder.generation !== generation) {
			throw new Error(vscode.l10n.t('The data explorer closed or was refreshed again before the refresh finished.'));
		}

		// Replace the view in place rather than closing the dataset, which would abandon a column
		// profile request that is waiting for the view.
		this._views.set(datasetId, view);
	}

	/**
	 * Builds a dataset's view and registers it, replacing any prior view for the same dataset id and
	 * remembering how it was built so that it can be refreshed.
	 */
	private async _openView(datasetId: string, build: () => Promise<SnowflakeTableView>): Promise<void> {
		this._views.set(datasetId, await build());
		this._builders.set(datasetId, { build, generation: 0 });
	}

	/** Drops a dataset's view when its Data Explorer tab closes or its connection is disconnected. */
	closeTableView(datasetId: string): void {
		this._views.delete(datasetId);
		this._builders.delete(datasetId);
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
				return this._getColumnProfiles(rpc.uri, rpc.params as GetColumnProfilesParams);
			default:
				throw new Error(`Unsupported data explorer method: ${rpc.method}`);
		}
	}

	/**
	 * Column profiles are computed asynchronously: acknowledge the request immediately, record it as
	 * the dataset's latest pending pass (cancelling any running one), and let the drain loop compute it
	 * and push the results to the frontend via the registration session.
	 */
	private _getColumnProfiles(datasetId: string, params: GetColumnProfilesParams): void {
		this._profilePending.set(datasetId, params);
		// Supersede a running pass so it abandons itself at the next statement boundary.
		const current = this._profileCurrent.get(datasetId);
		if (current) {
			current.isCancellationRequested = true;
		}
		if (!this._profileDraining.has(datasetId)) {
			void this._drainColumnProfiles(datasetId);
		}
	}

	/**
	 * Runs the dataset's pending profile passes one at a time until none remain. Because a newer
	 * request overwrites the single pending slot and cancels the running pass, only the latest request
	 * of a burst is fully computed; the connection never carries more than one pass's statements.
	 */
	private async _drainColumnProfiles(datasetId: string): Promise<void> {
		this._profileDraining.add(datasetId);
		try {
			let params: GetColumnProfilesParams | undefined;
			while ((params = this._profilePending.get(datasetId)) !== undefined) {
				this._profilePending.delete(datasetId);
				// Look the view up for each pass rather than holding the one the loop started with. A tab
				// that closes and reopens gets a new view under the same dataset id while this loop may
				// still be finishing the closed view's pass, and the reopened tab's request must run on
				// its own view.
				const view = this._views.get(datasetId);
				if (!view) {
					break;
				}
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

/** How a dataset's view is built, and how many times it has been rebuilt. */
interface ViewBuilder {
	readonly build: () => Promise<SnowflakeTableView>;
	generation: number;
}

/**
 * Checks that a rebuilt view can be shown before it replaces the old one: that its relation still
 * has columns (the catalog reports none for a relation that no longer exists) and that its row
 * count can be read.
 */
async function validateRebuiltView(view: SnowflakeTableView): Promise<void> {
	const state = await view.getState();
	if (state.table_unfiltered_shape.num_columns === 0) {
		throw new Error(vscode.l10n.t("'{0}' has no columns. It may have been dropped or renamed.", state.display_name));
	}
}
