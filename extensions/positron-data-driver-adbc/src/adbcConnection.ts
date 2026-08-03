/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { AdbcTableRef, AdbcWorkerClient } from './adbcWorkerClient.js';
import { makeQuoteIdentifier, QuoteIdentifier, resolveQuoteStyle } from './adbcDialect.js';
import { IAdbcDataExplorerHost, ADBC_DATA_EXPLORER_PROVIDER_ID } from './adbcDataExplorerRpcHandler.js';
import { createRootNodes, IAdbcPreviewHost } from './adbcNodes.js';
import { WorkerOpenConfig } from './adbcWorkerProtocol.js';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/**
 * A live ADBC connection implementing the DataConnection interface.
 *
 * The driver itself runs in a child process (see AdbcWorkerClient); this class owns that
 * worker, exposes the schema tree over it, and registers previewed tables with the Data
 * Explorer.
 */
export class AdbcConnection implements positron.DataConnection, IAdbcPreviewHost {
	// The worker client, or null after disconnect.
	private _client: AdbcWorkerClient | null;

	// Unique id for this connection, used to key its previewed datasets.
	private readonly _connectionId = `adbc-${nextConnectionId++}`;

	// Dataset ids opened via the preview methods, so they can be released on disconnect.
	private readonly _openedDatasets = new Set<string>();

	// Quotes identifiers in the connected engine's dialect. Resolved during connect() from
	// what the driver reports about itself; until then, the SQL standard.
	private _quote: QuoteIdentifier = makeQuoteIdentifier('ansi');

	/**
	 * Constructor. Call connect() after constructing to establish the connection.
	 * @param _config The driver open configuration, forwarded to the worker.
	 * @param _dataExplorerHandler Hosts table views previewed in the Data Explorer.
	 * @param client Overrides the worker client; exists only for tests.
	 */
	constructor(
		private readonly _config: WorkerOpenConfig,
		private readonly _dataExplorerHandler: IAdbcDataExplorerHost,
		client?: AdbcWorkerClient
	) {
		this._client = client ?? new AdbcWorkerClient(_config);
	}

	/**
	 * Establishes the connection. The worker loads the driver lazily on its first
	 * request, so this pings it: a driver that cannot be found or a URI that cannot be
	 * reached fails here rather than on the user's first click in the tree.
	 */
	async connect(): Promise<void> {
		if (!this._client) {
			throw new Error('ADBC connection has been disconnected');
		}
		try {
			await this._client.ping();
		} catch (err: any) {
			const client = this._client;
			this._client = null;
			client.dispose();
			throw this._connectError(err);
		}

		// Resolve the SQL dialect now that the driver is loaded. Identifier quoting is not
		// portable -- Databricks, Spark, and MySQL use backticks and read a double-quoted
		// token as a string literal -- so every query this connection generates depends on
		// getting this right. GetInfo is optional in ADBC, so the configured driver string
		// (a short name like 'databricks', or a path to databricks.toml) is folded in as a
		// fallback signal.
		const info = await this._client.getInfo().catch(() => ({}));
		this._quote = makeQuoteIdentifier(resolveQuoteStyle(this._config.identifierQuoting ?? 'auto', {
			...info,
			configuredDriver: this._config.driver,
		}));
	}

	/**
	 * Builds the error thrown when the driver fails to load or connect, naming what we
	 * tried to open so the message points at the parameter the user got wrong.
	 */
	private _connectError(err: any): Error {
		const target = this._config.driver
			?? this._config.databaseOptions?.uri
			?? this._config.databaseOptions?.profile
			?? 'the configured driver';
		return new Error(`Failed to connect with the ADBC driver '${target}': ${err.message}`);
	}

	/**
	 * Gets a value which indicates whether the connection is read only. Reflects what the
	 * user asked for: not every driver honors the read-only option, and ADBC provides no
	 * way to read the effective setting back.
	 */
	async isReadOnly(): Promise<boolean> {
		return this._config.readOnly;
	}

	/** Returns the top-level nodes: catalogs, schemas, or table groups (see createRootNodes). */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		return createRootNodes(this._client!, this);
	}

	/**
	 * Opens the given table or view in the Data Explorer. Registers a table view with the
	 * RPC handler under a stable per-connection dataset id, then asks Positron to open (or
	 * focus) the explorer backed by this extension's provider.
	 */
	async previewObject(ref: AdbcTableRef): Promise<void> {
		this._ensureConnected();
		const datasetId = `${this._datasetPrefix(ref)}:table`;
		await this._dataExplorerHandler.openTableView(datasetId, this._client!, ref, this._quote);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: ADBC_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: ref.tableName,
		});
	}

	/**
	 * Opens a single column of the given table or view in the Data Explorer as a
	 * one-column grid. Uses a dataset id distinct from the table's so both can be open at
	 * once.
	 */
	async previewColumn(ref: AdbcTableRef, columnName: string): Promise<void> {
		this._ensureConnected();
		const datasetId = `${this._datasetPrefix(ref)}:column:${columnName}`;
		await this._dataExplorerHandler.openColumnView(datasetId, this._client!, ref, this._quote, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: ADBC_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: `${ref.tableName}.${columnName}`,
		});
	}

	/** The dataset id prefix for a table, unique per connection, catalog, and schema. */
	private _datasetPrefix(ref: AdbcTableRef): string {
		return `adbc:${this._connectionId}:${ref.catalog ?? ''}:${ref.dbSchema ?? ''}:${ref.tableName}`;
	}

	/** Closes the connection and releases any previewed table views. Idempotent. */
	async disconnect(): Promise<void> {
		for (const datasetId of this._openedDatasets) {
			this._dataExplorerHandler.closeTableView(datasetId);
		}
		this._openedDatasets.clear();
		if (this._client) {
			this._client.dispose();
			this._client = null;
		}
	}

	/** Checks whether the connection is still open and operational. */
	async isConnected(): Promise<boolean> {
		if (!this._client) {
			return false;
		}
		try {
			await this._client.ping();
			return true;
		} catch {
			return false;
		}
	}

	// Throws if the connection has been disconnected.
	private _ensureConnected(): void {
		if (!this._client) {
			throw new Error('ADBC connection is closed');
		}
	}
}
