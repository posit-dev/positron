/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Amazon Redshift speaks the PostgreSQL wire protocol, so the `pg` client connects to it directly.
// This driver was cloned from positron-data-driver-postgresql, but Redshift connections are always
// scoped to a single database (you must name a database to connect to a cluster), so the Postgres
// "server mode" that enumerates databases via the `postgres` maintenance database is intentionally
// absent here. The top-level nodes are always the schemas of the connected database.

import { Client } from 'pg';
import * as positron from 'positron';
import { ConnectionOptions } from 'tls';
import { createSchemasGroupNode, IRedshiftPreviewHost } from './redshiftNodes.js';
import { IRedshiftDataExplorerHost, REDSHIFT_DATA_EXPLORER_PROVIDER_ID } from './redshiftDataExplorerRpcHandler.js';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/**
 * The discrete connection fields for a Redshift connection. Host, port, database, and user identify
 * the cluster and login; the password is optional only in that future auth mechanisms (IAM, Okta)
 * will mint a temporary one. SSL defaults on because Redshift endpoints expect an encrypted
 * connection.
 */
export interface RedshiftFieldConfig {
	host: string;
	port: number;
	database: string;
	user: string;
	password?: string;
	ssl?: boolean;
}

/**
 * Connection configuration passed from the driver. Only the discrete-fields form is supported today;
 * the `kind` discriminant leaves room for a connection-string form later without changing callers.
 */
export type RedshiftConnectionConfig = { kind: 'fields' } & RedshiftFieldConfig;

/**
 * Builds the `ssl` option for the pg Client. Redshift terminates TLS with an ACM-issued certificate;
 * verifying it requires bundling the Redshift CA, which this MVP does not yet do, so SSL is enabled
 * without server-certificate verification (the connection is still encrypted). Returns false only
 * when SSL is explicitly disabled.
 */
function buildSslConfig(config: RedshiftFieldConfig): boolean | ConnectionOptions {
	// Default to on: Redshift expects SSL, so treat an unset value as enabled.
	if (config.ssl === false) {
		return false;
	}
	// TODO: bundle the Redshift CA and switch to { rejectUnauthorized: true, ca } for verification.
	return { rejectUnauthorized: false };
}

/**
 * A live Amazon Redshift connection implementing the DataConnection interface. Connects via the pg
 * Client and provides schema browsing via getChildren(), always scoped to the single configured
 * database.
 */
export class RedshiftConnection implements positron.DataConnection, IRedshiftPreviewHost {
	// The pg client, or null after disconnect.
	private _client: Client | null;

	// Unique id for this connection, used to key its previewed datasets.
	private readonly _connectionId = `redshift-${nextConnectionId++}`;

	// Dataset ids opened via the preview methods, so they can be released on disconnect.
	private readonly _openedDatasets = new Set<string>();

	/**
	 * Constructor. Call connect() after constructing to establish the connection.
	 * @param _config The connection configuration.
	 * @param _dataExplorerHandler Hosts table views previewed in the Data Explorer.
	 */
	constructor(
		private readonly _config: RedshiftConnectionConfig,
		private readonly _dataExplorerHandler: IRedshiftDataExplorerHost
	) {
		this._client = this._buildClient();
	}

	/** Builds a pg client from the connection config. */
	private _buildClient(): Client {
		return new Client({
			host: this._config.host,
			port: this._config.port,
			user: this._config.user,
			password: this._config.password,
			database: this._config.database,
			ssl: buildSslConfig(this._config),
		});
	}

	/** Establishes the connection. Must be called before any other method. */
	async connect(): Promise<void> {
		if (!this._client) {
			throw new Error('Redshift connection has been disconnected');
		}
		try {
			await this._client.connect();
		} catch (err: any) {
			this._client = null;
			throw new Error(`Failed to connect to Redshift at ${this._config.host}:${this._config.port}: ${err.message}`);
		}
	}

	/**
	 * Gets a value which indicates whether the connection is read only. Redshift connections are
	 * exposed as read/write; read-only is not offered as a connection parameter.
	 */
	async isReadOnly(): Promise<boolean> {
		return false;
	}

	/**
	 * Returns top-level children: a single "Schemas" group that lists every non-system schema in the
	 * connected database.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		return [createSchemasGroupNode(this._client!, this)];
	}

	/**
	 * Opens the given table or view in the Data Explorer. Registers a table view with the RPC handler
	 * under a stable per-connection dataset id, then asks Positron to open (or focus) the explorer
	 * backed by this extension's provider.
	 */
	async previewObject(client: Client, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void> {
		this._ensureConnected();
		const datasetId = `redshift:${this._connectionId}:${kind}:${schemaName}.${tableName}`;
		await this._dataExplorerHandler.openTableView(datasetId, this._queryClient(client), schemaName, tableName, kind);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: REDSHIFT_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: tableName,
		});
	}

	/**
	 * Opens a single column of the given table or view in the Data Explorer as a one-column grid.
	 * Uses a dataset id distinct from the table's so both can be open at once.
	 */
	async previewColumn(client: Client, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void> {
		this._ensureConnected();
		const datasetId = `redshift:${this._connectionId}:column:${schemaName}.${tableName}.${columnName}`;
		await this._dataExplorerHandler.openColumnView(datasetId, this._queryClient(client), schemaName, tableName, kind, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: REDSHIFT_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: `${tableName}.${columnName}`,
		});
	}

	/** A query client over the given pg client, for the Data Explorer table views. */
	private _queryClient(client: Client) {
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
			throw new Error('Redshift connection is closed');
		}
	}
}
