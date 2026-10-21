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
import { isBinarySqlType, odbcDisplayType, OdbcSchemaEntry, OdbcTableView, resolveOdbcRowIdentity } from './odbcTableView';
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
		this._session = registerRpcHandler(ODBC_DATA_EXPLORER_PROVIDER_ID, {
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
		client: IOdbcQueryClient,
		ref: OdbcTableRef,
		dialect: OdbcDialect,
	): Promise<void> {
		await this._openView(datasetId, async () => {
			const [schema, rowIdentity] = await Promise.all([
				buildOdbcSchema(client, ref),
				resolveOdbcRowIdentity(client, ref),
			]);
			return new OdbcTableView(client, ref, dialect, schema, rowIdentity);
		});
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
		await this._openView(datasetId, async () => {
			const [schema, rowIdentity] = await Promise.all([
				buildOdbcSchema(client, ref),
				resolveOdbcRowIdentity(client, ref),
			]);
			const column = schema.find(c => c.column_name === columnName);
			if (!column) {
				throw new Error(`Column '${columnName}' not found in '${ref.name}'`);
			}
			// The key columns are outside this view's one-column schema, but ORDER BY may name a column
			// the SELECT list omits, so they still serve as the tiebreaker.
			return new OdbcTableView(client, ref, dialect, [column], rowIdentity);
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
			throw new Error(`No ODBC data explorer is open for ${datasetId}`);
		}

		const generation = ++builder.generation;
		const view = await builder.build();
		await validateRebuiltView(view);

		// The dataset may have closed, been reopened, or been refreshed again while this view was
		// being built. Installing it then would resurrect a closed dataset or replace a newer view.
		if (this._builders.get(datasetId) !== builder || builder.generation !== generation) {
			throw new Error(vscode.l10n.t('The data explorer closed or was refreshed again before the refresh finished.'));
		}

		this._views.set(datasetId, view);
	}

	/**
	 * Builds a dataset's view and registers it, replacing any prior view for the same dataset id and
	 * remembering how it was built so that it can be refreshed.
	 */
	private async _openView(datasetId: string, build: () => Promise<OdbcTableView>): Promise<void> {
		this._views.set(datasetId, await build());
		this._builders.set(datasetId, { build, generation: 0 });
	}

	/** Drops a dataset's view when its Data Explorer tab closes or its connection is disconnected. */
	closeTableView(datasetId: string): void {
		this._views.delete(datasetId);
		this._builders.delete(datasetId);
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
			const code = Number.isFinite(dataType) ? dataType : undefined;
			return {
				column_name: String(row['COLUMN_NAME'] ?? ''),
				column_type: typeName,
				type_display: odbcDisplayType(code, typeName),
				is_binary: isBinarySqlType(code),
				ordinal: Number(row['ORDINAL_POSITION'] ?? 0),
			};
		})
		.filter(entry => entry.column_name.length > 0)
		.sort((a, b) => a.ordinal - b.ordinal)
		.map(({ column_name, column_type, type_display, is_binary }) => ({ column_name, column_type, type_display, is_binary }));
}

/** How a dataset's view is built, and how many times it has been rebuilt. */
interface ViewBuilder {
	readonly build: () => Promise<OdbcTableView>;
	generation: number;
}

/**
 * Checks that a rebuilt view can be shown before it replaces the old one: that its relation still
 * has columns (the catalog reports none for a relation that no longer exists) and that its row
 * count can be read.
 */
async function validateRebuiltView(view: OdbcTableView): Promise<void> {
	const state = await view.getState();
	if (state.table_unfiltered_shape.num_columns === 0) {
		throw new Error(vscode.l10n.t("'{0}' has no columns. It may have been dropped or renamed.", state.display_name));
	}
}
