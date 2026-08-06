/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A live Databricks connection implementing the DataConnection interface. Structurally follows the
// Snowflake driver's connection: a Databricks connection can query every catalog its credentials are
// granted on, so it is always browsed cross-catalog -- the top-level nodes are the workspace's
// catalogs, and there is no single-catalog fallback to detect.

import * as positron from 'positron';
import { DatabricksClient, DatabricksConnectionOptions } from './databricksClient.js';
import { createCatalogsGroupNode, IDatabricksPreviewHost } from './databricksNodes.js';
import { IDatabricksDataExplorerHost, DATABRICKS_DATA_EXPLORER_PROVIDER_ID } from './databricksDataExplorerRpcHandler.js';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/**
 * Builds a collision-proof dataset id from a connection id, a kind tag, and the object-name
 * components. Each component is URL-encoded and joined with ':' -- the one delimiter encoding escapes
 * -- so identifiers containing '.', ':', or other delimiter characters (legal in backtick-quoted
 * Databricks object names) can never map two distinct objects onto the same id.
 */
function datasetKey(connectionId: string, kind: string, ...parts: string[]): string {
	return ['databricks', connectionId, kind, ...parts].map(encodeURIComponent).join(':');
}

/** The connection configuration passed from the driver: the normalized connection options. */
export type DatabricksConnectionConfig = DatabricksConnectionOptions;

/**
 * A live Databricks connection. Connects via a reconnecting @databricks/sql client and provides
 * schema browsing via getChildren(), always rooted at the workspace's catalogs.
 */
export class DatabricksConnection implements positron.DataConnection, IDatabricksPreviewHost {
	// The reconnecting SDK client, or null after disconnect.
	private _client: DatabricksClient | null;

	// Unique id for this connection, used to key its previewed datasets.
	private readonly _connectionId = `databricks-${nextConnectionId++}`;

	// Dataset ids opened via the preview methods, so they can be released on disconnect.
	private readonly _openedDatasets = new Set<string>();

	/**
	 * Constructor. Call connect() after constructing to establish the connection.
	 * @param _config The connection configuration.
	 * @param _dataExplorerHandler Hosts table views previewed in the Data Explorer.
	 */
	constructor(
		private readonly _config: DatabricksConnectionConfig,
		private readonly _dataExplorerHandler: IDatabricksDataExplorerHost
	) {
		this._client = new DatabricksClient(this._config);
	}

	/** Establishes the connection. Must be called before any other method. */
	async connect(): Promise<void> {
		if (!this._client) {
			throw new Error('Databricks connection has been disconnected');
		}
		try {
			await this._client.connect();
		} catch (err: any) {
			this._client = null;
			throw new Error(`Failed to connect to Databricks workspace ${this._config.host}: ${err.message}`);
		}
	}

	/**
	 * Gets a value which indicates whether the connection is read only. Databricks connections are
	 * exposed as read/write; read-only is not offered as a connection parameter.
	 */
	async isReadOnly(): Promise<boolean> {
		return false;
	}

	/** Returns top-level children: a single "Catalogs" group listing the workspace's catalogs. */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		return [createCatalogsGroupNode(this._client!, this)];
	}

	/**
	 * Opens the given table or view in the Data Explorer. Registers a table view with the RPC handler
	 * under a stable per-connection dataset id, then asks Positron to open (or focus) the explorer
	 * backed by this extension's provider. Returns the dataset id it was opened under, which Positron
	 * uses to tell that this connection has a Data Explorer open on it.
	 */
	async previewObject(client: DatabricksClient, catalog: string, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<string> {
		this._ensureConnected();
		const datasetId = datasetKey(this._connectionId, kind, catalog, schemaName, tableName);
		await this._dataExplorerHandler.openTableView(datasetId, this._queryClient(client), catalog, schemaName, tableName, kind);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: DATABRICKS_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: tableName,
		});
		return datasetId;
	}

	/**
	 * Opens a single column of the given table or view in the Data Explorer as a one-column grid.
	 * Uses a dataset id distinct from the table's so both can be open at once. Returns the dataset id
	 * it was opened under.
	 */
	async previewColumn(client: DatabricksClient, catalog: string, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<string> {
		this._ensureConnected();
		const datasetId = datasetKey(this._connectionId, 'column', catalog, schemaName, tableName, columnName);
		await this._dataExplorerHandler.openColumnView(datasetId, this._queryClient(client), catalog, schemaName, tableName, kind, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: DATABRICKS_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: `${tableName}.${columnName}`,
		});
		return datasetId;
	}

	/** A query client over the given SDK client, for the Data Explorer table views. */
	private _queryClient(client: DatabricksClient) {
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
			throw new Error('Databricks connection is closed');
		}
	}
}
