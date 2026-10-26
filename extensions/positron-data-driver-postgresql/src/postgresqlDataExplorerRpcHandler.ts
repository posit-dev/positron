/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-sqlite's sqliteDataExplorerRpcHandler.ts; differs only
// in the provider id, the schema-qualified table reference, and the information_schema schema query.

import * as positron from 'positron';
import * as vscode from 'vscode';
import { IPostgresQueryClient, PostgresSchemaEntry, PostgresTableView, postgresDisplayType } from './postgresqlTableView.js';
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
export const POSTGRESQL_DATA_EXPLORER_PROVIDER_ID = 'positron-data-driver-postgresql';

/**
 * The slice of the RPC handler a connection needs to preview its tables. Kept as an interface so a
 * connection can be tested without registering the real Data Explorer provider.
 */
export interface IPostgresDataExplorerHost {
	/** Builds and registers a table view for a table or view under the given dataset id. */
	openTableView(datasetId: string, client: IPostgresQueryClient, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void>;
	/** Builds and registers a single-column view of a table or view under the given dataset id. */
	openColumnView(datasetId: string, client: IPostgresQueryClient, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void>;
	/** Drops a dataset's view. */
	closeTableView(datasetId: string): void;
}

/**
 * Hosts PostgreSQL-backed Data Explorer table views and dispatches Data Explorer RPCs to them.
 *
 * A data connection node registers a table view via `openTableView` (from its preview action) and
 * then asks Positron to open an explorer keyed by the same dataset id. Positron routes every RPC
 * for that dataset to this handler (registered via `positron.dataExplorer.registerRpcHandler`).
 * Async column profiles are delivered back through the registration session's `sendUiEvent`.
 */
export class PostgresDataExplorerRpcHandler implements vscode.Disposable, IPostgresDataExplorerHost {
	private readonly _views = new Map<string, PostgresTableView>();
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
		this._session = registerRpcHandler(POSTGRESQL_DATA_EXPLORER_PROVIDER_ID, {
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
		client: IPostgresQueryClient,
		schemaName: string,
		tableName: string,
		kind: 'table' | 'view',
	): Promise<void> {
		await this._openView(datasetId, async () => {
			const [schema, rowIdentity] = await Promise.all([
				buildPostgresSchema(client, schemaName, tableName),
				resolvePostgresRowIdentity(client, schemaName, tableName, kind),
			]);
			return new PostgresTableView(client, tableRef(schemaName, tableName), tableName, schema, rowIdentity);
		});
	}

	/**
	 * Builds and registers a single-column view: a PostgresTableView whose schema is restricted to
	 * the one requested column, so the Data Explorer shows just that column.
	 */
	async openColumnView(
		datasetId: string,
		client: IPostgresQueryClient,
		schemaName: string,
		tableName: string,
		kind: 'table' | 'view',
		columnName: string,
	): Promise<void> {
		await this._openView(datasetId, async () => {
			const [schema, rowIdentity] = await Promise.all([
				buildPostgresSchema(client, schemaName, tableName),
				resolvePostgresRowIdentity(client, schemaName, tableName, kind),
			]);
			const column = schema.find(c => c.column_name === columnName);
			if (!column) {
				throw new Error(`Column '${columnName}' not found in '${schemaName}.${tableName}'`);
			}
			return new PostgresTableView(client, tableRef(schemaName, tableName), tableName, [column], rowIdentity);
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
			throw new Error(`No PostgreSQL data explorer is open for ${datasetId}`);
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
	private async _openView(datasetId: string, build: () => Promise<PostgresTableView>): Promise<void> {
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
			throw new Error(`No PostgreSQL data explorer is open for ${rpc.uri}`);
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
	private _getColumnProfiles(view: PostgresTableView, datasetId: string, params: GetColumnProfilesParams): void {
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
				this._logger?.error(`Failed to compute PostgreSQL column profiles: ${message}`);
			}
		})();
	}
}

/** Builds a schema-qualified, double-quote-escaped table reference (e.g. `"public"."t"`). */
function tableRef(schemaName: string, tableName: string): string {
	const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"';
	return `${quote(schemaName)}.${quote(tableName)}`;
}

/** Renders a value as an escaped SQL string literal. */
function literal(value: string): string {
	return `'${value.replace(/'/g, '\'\'')}'`;
}

/**
 * Reads a table or view's column schema via information_schema.columns and resolves each column's
 * display type. Schema and table names are inlined as escaped string literals.
 */
export async function buildPostgresSchema(
	client: IPostgresQueryClient,
	schemaName: string,
	relationName: string,
): Promise<PostgresSchemaEntry[]> {
	const rows = await client.runQuery(
		`SELECT column_name, data_type FROM information_schema.columns ` +
		`WHERE table_schema = ${literal(schemaName)} AND table_name = ${literal(relationName)} ` +
		`ORDER BY ordinal_position`
	);
	return rows.map(row => {
		const dataType = String(row.data_type);
		return {
			column_name: String(row.column_name),
			column_type: dataType,
			type_display: postgresDisplayType(dataType),
		};
	});
}

/**
 * Resolves the columns of an enforced unique key on a table, for paging it in place: a primary key,
 * or else the narrowest unique index whose columns are all NOT NULL. Returns none for a view, for a
 * table with no such key, or when the catalog cannot be read, and the table view then reads rows from
 * a result window instead.
 *
 * An index qualifies only if it is valid, plain (no predicate, no expressions), and collates each
 * column as the column itself does, since ORDER BY uses the column's collation and a different one
 * could tie values the index keeps apart. A key on a table that other tables inherit from does not
 * qualify: it covers only the parent's own rows, while a query on the parent also returns its
 * children's. A partitioned table's unique index does, since it must include the partition key.
 */
export async function resolvePostgresRowIdentity(
	client: IPostgresQueryClient,
	schemaName: string,
	relationName: string,
	kind: 'table' | 'view',
): Promise<string[]> {
	if (kind !== 'table') {
		return [];
	}
	let rows: Array<Record<string, unknown>>;
	try {
		rows = await client.runQuery(
			`SELECT i.indexrelid::bigint AS index_id, i.indisprimary AS is_primary, k.ord AS ord, ` +
			`a.attname AS column_name, a.attnotnull AS not_null, ` +
			`(i.indcollation::oid[])[k.ord - 1] = a.attcollation AS same_collation ` +
			`FROM pg_index i ` +
			`JOIN pg_class c ON c.oid = i.indrelid ` +
			`JOIN pg_namespace n ON n.oid = c.relnamespace ` +
			`CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord) ` +
			`LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum ` +
			`WHERE n.nspname = ${literal(schemaName)} AND c.relname = ${literal(relationName)} ` +
			`AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL ` +
			`AND k.ord <= i.indnkeyatts ` +
			`AND (c.relkind = 'p' OR NOT EXISTS (SELECT 1 FROM pg_inherits h WHERE h.inhparent = c.oid)) ` +
			`ORDER BY i.indexrelid, k.ord`
		);
	} catch {
		return [];
	}

	// Group the key columns by index, in key order.
	const indexes = new Map<string, { isPrimary: boolean; columns: string[]; usable: boolean }>();
	for (const row of rows) {
		const id = String(row.index_id);
		let index = indexes.get(id);
		if (!index) {
			index = { isPrimary: row.is_primary === true, columns: [], usable: true };
			indexes.set(id, index);
		}
		if (row.column_name === null || row.column_name === undefined || row.not_null !== true || row.same_collation !== true) {
			index.usable = false;
		} else {
			index.columns.push(String(row.column_name));
		}
	}
	const usable = [...indexes.values()].filter(index => index.usable && index.columns.length > 0);
	usable.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.columns.length - b.columns.length);
	return usable[0]?.columns ?? [];
}

/** How a dataset's view is built, and how many times it has been rebuilt. */
interface ViewBuilder {
	readonly build: () => Promise<PostgresTableView>;
	generation: number;
}

/**
 * Checks that a rebuilt view can be shown before it replaces the old one: that its relation still
 * has columns (the catalog reports none for a relation that no longer exists) and that its row
 * count can be read.
 */
async function validateRebuiltView(view: PostgresTableView): Promise<void> {
	const state = await view.getState();
	if (state.table_unfiltered_shape.num_columns === 0) {
		throw new Error(vscode.l10n.t("'{0}' has no columns. It may have been dropped or renamed.", state.display_name));
	}
}
