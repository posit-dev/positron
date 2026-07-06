/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { Client } from 'pg';
import * as positron from 'positron';
import { ConnectionOptions } from 'tls';
import { createSchemasGroupNode, IPostgresPreviewHost } from './postgresqlNodes.js';
import { IPostgresDataExplorerHost, POSTGRESQL_DATA_EXPLORER_PROVIDER_ID } from './postgresqlDataExplorerRpcHandler.js';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/**
 * The discrete connection fields, used when not connecting via a connection string. All are optional
 * and mirror the pg client's own configuration: the local-server mechanism omits host, port, password,
 * and SSL to connect over a local Unix domain socket, and the user/password mechanism may omit the
 * user and password. When omitted, the pg client falls back to its defaults (local socket, port 5432,
 * the operating system account via PGUSER, no password).
 */
export interface PostgreSQLFieldConfig {
	host?: string;
	port?: number;
	database?: string;
	user?: string;
	password?: string;
	ssl?: boolean;
	// Paths to the PEM files for client-certificate authentication. When any is set, SSL is enabled
	// regardless of `ssl`, and the server certificate is verified only when `sslRootCert` is supplied.
	sslRootCert?: string;
	sslCert?: string;
	sslKey?: string;
}

/**
 * Connection configuration passed from the driver. Either a ready-made connection string or the
 * discrete connection fields -- never both. The pg client is itself bimodal this way; the `kind`
 * discriminant makes the two mutually exclusive by construction.
 */
export type PostgreSQLConnectionConfig =
	// A libpq connection string (URL or key=value DSN), handed to the pg client as-is.
	| { kind: 'connectionString'; connectionString: string }
	| ({ kind: 'fields' } & PostgreSQLFieldConfig);

/**
 * Builds the `ssl` option for the pg Client from the discrete connection fields. Returns false when
 * SSL is off, a permissive object when SSL is requested without certificates, and a full TLS option
 * set (reading the certificate files into memory) for client-certificate authentication. The server
 * certificate is verified only when a CA certificate is supplied.
 */
function buildSslConfig(config: PostgreSQLFieldConfig): boolean | ConnectionOptions {
	if (config.sslRootCert || config.sslCert || config.sslKey) {
		return {
			rejectUnauthorized: Boolean(config.sslRootCert),
			ca: config.sslRootCert ? readFileSync(config.sslRootCert) : undefined,
			cert: config.sslCert ? readFileSync(config.sslCert) : undefined,
			key: config.sslKey ? readFileSync(config.sslKey) : undefined,
		};
	}
	return config.ssl ? { rejectUnauthorized: false } : false;
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
		// A connection string is handed to the pg client verbatim (it parses and applies any SSL
		// options itself); otherwise the connection is built from the individual fields.
		this._client = _config.kind === 'connectionString'
			? new Client({ connectionString: _config.connectionString })
			: new Client({
				host: _config.host,
				port: _config.port,
				database: _config.database,
				user: _config.user,
				password: _config.password,
				ssl: buildSslConfig(_config),
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
			// Report what we tried to connect to. A connection string hides the host; a socket-directory
			// host (or no host) means a local-socket connection; otherwise report the host:port.
			let target: string;
			if (this._config.kind === 'connectionString') {
				target = 'the server in the connection string';
			} else if (this._config.host && !this._config.host.startsWith('/')) {
				target = `${this._config.host}:${this._config.port ?? 5432}`;
			} else {
				target = 'the local socket';
			}
			throw new Error(`Failed to connect to PostgreSQL at ${target}: ${err.message}`);
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
