/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-postgresql's postgresqlDataExplorerRpcHandler.ts; differs
// only in the provider id and the naming of the table-view types.

import * as positron from 'positron';
import * as vscode from 'vscode';
import { IRedshiftQueryClient, RedshiftSchemaEntry, RedshiftTableView, redshiftDisplayType } from './redshiftTableView.js';
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
		this._session = registerRpcHandler(REDSHIFT_DATA_EXPLORER_PROVIDER_ID, {
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
		client: IRedshiftQueryClient,
		database: string | undefined,
		schemaName: string,
		tableName: string,
		kind: 'table' | 'view',
	): Promise<void> {
		await this._openView(datasetId, async () => {
			const schema = await buildRedshiftSchema(client, database, schemaName, tableName);
			return new RedshiftTableView(client, tableRef(database, schemaName, tableName), tableName, kind, schema, this._logger);
		});
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
		await this._openView(datasetId, async () => {
			const schema = await buildRedshiftSchema(client, database, schemaName, tableName);
			const column = schema.find(c => c.column_name === columnName);
			if (!column) {
				throw new Error(`Column '${columnName}' not found in '${schemaName}.${tableName}'`);
			}
			return new RedshiftTableView(client, tableRef(database, schemaName, tableName), tableName, kind, [column], this._logger);
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
			throw new Error(`No Redshift data explorer is open for ${datasetId}`);
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
	private async _openView(datasetId: string, build: () => Promise<RedshiftTableView>): Promise<void> {
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

/** How a dataset's view is built, and how many times it has been rebuilt. */
interface ViewBuilder {
	readonly build: () => Promise<RedshiftTableView>;
	generation: number;
}

/**
 * Checks that a rebuilt view can be shown before it replaces the old one: that its relation still
 * has columns (the catalog reports none for a relation that no longer exists) and that its row
 * count can be read.
 */
async function validateRebuiltView(view: RedshiftTableView): Promise<void> {
	const state = await view.getState();
	if (state.table_unfiltered_shape.num_columns === 0) {
		throw new Error(vscode.l10n.t("'{0}' has no columns. It may have been dropped or renamed.", state.display_name));
	}
}
