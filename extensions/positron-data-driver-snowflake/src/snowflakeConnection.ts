/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A live Snowflake connection implementing the DataConnection interface. Structurally follows the
// Redshift driver's connection, with one simplification: a Snowflake connection can query every
// database the role can access, so it is always browsed cross-database -- the top-level nodes are the
// databases in the account, and there is no single-database fallback to detect.

import * as positron from 'positron';
import { SnowflakeClient, SnowflakeConnectionOptions } from './snowflakeClient.js';
import { createDatabasesGroupNode, ISnowflakePreviewHost } from './snowflakeNodes.js';
import { ISnowflakeDataExplorerHost, SNOWFLAKE_DATA_EXPLORER_PROVIDER_ID } from './snowflakeDataExplorerRpcHandler.js';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/** The connection configuration passed from the driver: the normalized snowflake-sdk options. */
export type SnowflakeConnectionConfig = SnowflakeConnectionOptions;

/**
 * A live Snowflake connection. Connects via a reconnecting snowflake-sdk client and provides schema
 * browsing via getChildren(), always rooted at the account's accessible databases.
 */
export class SnowflakeConnection implements positron.DataConnection, ISnowflakePreviewHost {
	// The reconnecting sdk client, or null after disconnect.
	private _client: SnowflakeClient | null;

	// Unique id for this connection, used to key its previewed datasets.
	private readonly _connectionId = `snowflake-${nextConnectionId++}`;

	// Dataset ids opened via the preview methods, so they can be released on disconnect.
	private readonly _openedDatasets = new Set<string>();

	/**
	 * Constructor. Call connect() after constructing to establish the connection.
	 * @param _config The connection configuration.
	 * @param _dataExplorerHandler Hosts table views previewed in the Data Explorer.
	 */
	constructor(
		private readonly _config: SnowflakeConnectionConfig,
		private readonly _dataExplorerHandler: ISnowflakeDataExplorerHost
	) {
		this._client = new SnowflakeClient(this._config);
	}

	/** Establishes the connection. Must be called before any other method. */
	async connect(): Promise<void> {
		if (!this._client) {
			throw new Error('Snowflake connection has been disconnected');
		}
		try {
			await this._client.connect();
		} catch (err: any) {
			this._client = null;
			throw new Error(`Failed to connect to Snowflake account ${this._config.account}: ${err.message}`);
		}
	}

	/**
	 * Gets a value which indicates whether the connection is read only. Snowflake connections are
	 * exposed as read/write; read-only is not offered as a connection parameter.
	 */
	async isReadOnly(): Promise<boolean> {
		return false;
	}

	/** Returns top-level children: a single "Databases" group listing the account's databases. */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		return [createDatabasesGroupNode(this._client!, this)];
	}

	/**
	 * Opens the given table or view in the Data Explorer. Registers a table view with the RPC handler
	 * under a stable per-connection dataset id, then asks Positron to open (or focus) the explorer
	 * backed by this extension's provider.
	 */
	async previewObject(client: SnowflakeClient, database: string, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void> {
		this._ensureConnected();
		const datasetId = `snowflake:${this._connectionId}:${database}:${kind}:${schemaName}.${tableName}`;
		await this._dataExplorerHandler.openTableView(datasetId, this._queryClient(client), database, schemaName, tableName, kind);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: SNOWFLAKE_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: tableName,
		});
	}

	/**
	 * Opens a single column of the given table or view in the Data Explorer as a one-column grid.
	 * Uses a dataset id distinct from the table's so both can be open at once.
	 */
	async previewColumn(client: SnowflakeClient, database: string, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void> {
		this._ensureConnected();
		const datasetId = `snowflake:${this._connectionId}:${database}:column:${schemaName}.${tableName}.${columnName}`;
		await this._dataExplorerHandler.openColumnView(datasetId, this._queryClient(client), database, schemaName, tableName, kind, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: SNOWFLAKE_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: `${tableName}.${columnName}`,
		});
	}

	/** A query client over the given sdk client, for the Data Explorer table views. */
	private _queryClient(client: SnowflakeClient) {
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
			throw new Error('Snowflake connection is closed');
		}
	}
}
