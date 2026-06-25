/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from 'pg';
import * as positron from 'positron';
import { createSchemasGroupNode, IPostgresPreviewHost } from './postgresqlNodes.js';
import { IPostgresDataExplorerHost, POSTGRESQL_DATA_EXPLORER_PROVIDER_ID } from './postgresqlDataExplorerRpcHandler.js';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/**
 * Connection configuration passed from the driver.
 */
export interface PostgreSQLConnectionConfig {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	ssl: boolean;
}

/**
 * A live PostgreSQL connection implementing the DataConnection interface.
 * Connects via the pg Client and provides schema browsing via getChildren().
 */
export class PostgreSQLConnection implements positron.DataConnection, IPostgresPreviewHost {
	// The pg client, or null after disconnect.
	private _client: Client | null;

	// Unique id for this connection, used to key its previewed datasets.
	private readonly _connectionId = `postgresql-${nextConnectionId++}`;

	// Dataset ids opened via the preview methods, so they can be released on disconnect.
	private readonly _openedDatasets = new Set<string>();

	/**
	 * Constructor. Call connect() after constructing to establish the connection.
	 * @param _config The connection configuration.
	 * @param _dataExplorerHandler Hosts table views previewed in the Data Explorer.
	 */
	constructor(
		private readonly _config: PostgreSQLConnectionConfig,
		private readonly _dataExplorerHandler: IPostgresDataExplorerHost
	) {
		this._client = new Client({
			host: _config.host,
			port: _config.port,
			database: _config.database,
			user: _config.user,
			password: _config.password,
			ssl: _config.ssl ? { rejectUnauthorized: false } : false,
		});
	}

	/**
	 * Establishes the connection. Must be called before any other method.
	 */
	async connect(): Promise<void> {
		if (!this._client) {
			throw new Error('PostgreSQL connection has been disconnected');
		}
		try {
			await this._client.connect();
		} catch (err: any) {
			this._client = null;
			throw new Error(`Failed to connect to PostgreSQL at ${this._config.host}:${this._config.port}: ${err.message}`);
		}
	}

	/**
	 * Gets a value which indicates whether the connection is read only. PostgreSQL connections are
	 * always read/write; read-only is not exposed as a connection parameter.
	 */
	async isReadOnly(): Promise<boolean> {
		return false;
	}

	/**
	 * Returns top-level children: a single "Schemas" group node that lists every non-system
	 * schema. Each schema node can be expanded to show its Tables and Views groups.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		return [createSchemasGroupNode(this._client!, this)];
	}

	/**
	 * Opens the given table or view in the Data Explorer. Registers a table view with the RPC
	 * handler under a stable per-connection dataset id, then asks Positron to open (or focus) the
	 * explorer backed by this extension's provider.
	 */
	async previewObject(schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void> {
		this._ensureConnected();
		const datasetId = `postgresql:${this._connectionId}:${kind}:${schemaName}.${tableName}`;
		await this._dataExplorerHandler.openTableView(datasetId, this._queryClient(), schemaName, tableName, kind);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: POSTGRESQL_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: tableName,
		});
	}

	/**
	 * Opens a single column of the given table or view in the Data Explorer as a one-column grid.
	 * Uses a dataset id distinct from the table's so both can be open at once.
	 */
	async previewColumn(schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void> {
		this._ensureConnected();
		const datasetId = `postgresql:${this._connectionId}:column:${schemaName}.${tableName}.${columnName}`;
		await this._dataExplorerHandler.openColumnView(datasetId, this._queryClient(), schemaName, tableName, kind, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: POSTGRESQL_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: `${tableName}.${columnName}`,
		});
	}

	/** A query client over this connection's pg client, for the Data Explorer table views. */
	private _queryClient() {
		const client = this._client!;
		return { runQuery: async (sql: string) => (await client.query(sql)).rows };
	}

	/** Closes the connection and releases any previewed table views. Idempotent. */
	async disconnect(): Promise<void> {
		for (const datasetId of this._openedDatasets) {
			this._dataExplorerHandler.closeTableView(datasetId);
		}
		this._openedDatasets.clear();
		if (this._client) {
			await this._client.end();
			this._client = null;
		}
	}

	/** Checks whether the connection is still open and operational. */
	async isConnected(): Promise<boolean> {
		if (!this._client) {
			return false;
		}
		try {
			await this._client.query('SELECT 1');
			return true;
		} catch {
			return false;
		}
	}

	// Throws if the connection has been disconnected.
	private _ensureConnected(): void {
		if (!this._client) {
			throw new Error('PostgreSQL connection is closed');
		}
	}
}
