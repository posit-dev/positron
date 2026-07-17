/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { Client } from 'pg';
import * as positron from 'positron';
import { ConnectionOptions } from 'tls';
import { PostgreSQLClient } from './postgresqlClient.js';
import { createDatabasesGroupNode, createSchemasGroupNode, IPostgresConnectionHost } from './postgresqlNodes.js';
import { IPostgresDataExplorerHost, POSTGRESQL_DATA_EXPLORER_PROVIDER_ID } from './postgresqlDataExplorerRpcHandler.js';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/**
 * The conventional PostgreSQL maintenance database. In server mode (no database specified) the base
 * client connects here to enumerate the databases on the server, matching what tools like pgAdmin do.
 * It exists on virtually every server; when it doesn't (or the role can't connect to it), the base
 * client falls back to the pg client's default database (the user name).
 */
const MAINTENANCE_DATABASE = 'postgres';

/**
 * How long the socket may sit idle before the OS sends its first TCP keepalive probe. Kept well under
 * the intervals at which idle-session timeouts and NAT tables tend to drop an idle connection, so the
 * socket stays warm across ordinary gaps in browsing.
 */
const KEEP_ALIVE_INITIAL_DELAY_MS = 30_000;

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
	user?: string;
	password?: string;
	database?: string;
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
 * Determines whether a libpq connection string names a database. The URL form
 * (postgresql://host/dbname) carries the database in the path; the key=value DSN form carries it in a
 * `dbname` or `database` key. When neither is present the connection targets the whole server, so
 * databases are browsable as the top-level nodes.
 */
function connectionStringHasDatabase(connectionString: string): boolean {
	try {
		const url = new URL(connectionString);
		if (url.protocol === 'postgresql:' || url.protocol === 'postgres:') {
			return url.pathname.replace(/^\//, '').length > 0;
		}
	} catch {
		// Not a URL; fall through to DSN handling.
	}
	// key=value DSN form: look for a non-empty dbname / database value.
	return /\b(?:dbname|database)\s*=\s*(?:'[^']+'|"[^"]+"|\S+)/i.test(connectionString);
}

/**
 * Returns a copy of a libpq connection string scoped to the given database, used to build a
 * per-database client in server mode. Rewrites the path of a URL-form string, or replaces/appends the
 * `dbname` key of a key=value DSN string.
 */
function withConnectionStringDatabase(connectionString: string, database: string): string {
	try {
		const url = new URL(connectionString);
		if (url.protocol === 'postgresql:' || url.protocol === 'postgres:') {
			url.pathname = `/${encodeURIComponent(database)}`;
			return url.toString();
		}
	} catch {
		// Not a URL; fall through to DSN handling.
	}
	// key=value DSN form: replace an existing dbname/database key, or append one if none is present.
	if (/\b(?:dbname|database)\s*=/i.test(connectionString)) {
		return connectionString.replace(
			/\b(?:dbname|database)(\s*=\s*)(?:'[^']*'|"[^"]*"|\S+)/i,
			`dbname$1'${database.replace(/'/g, '\\\'')}'`
		);
	}
	return `${connectionString} dbname='${database.replace(/'/g, '\\\'')}'`;
}

/**
 * A live PostgreSQL connection implementing the DataConnection interface.
 * Connects via the pg Client and provides schema browsing via getChildren().
 */
export class PostgreSQLConnection implements positron.DataConnection, IPostgresConnectionHost {
	// The reconnecting pg client, or null after disconnect. In server mode this is the base client used
	// to list databases; per-database browsing uses the clients cached in _databaseClients.
	private _client: PostgreSQLClient | null;

	// Whether the connection targets the whole server (no database specified). In server mode the
	// top-level nodes are the databases; otherwise they are the schemas of the single database.
	private readonly _serverMode: boolean;

	// Per-database clients created lazily in server mode, keyed by database name. Cached as promises so
	// concurrent expansions of the same database node share a single client, and closed on disconnect.
	private readonly _databaseClients = new Map<string, Promise<PostgreSQLClient>>();

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
		// Server mode when no database is specified: for fields, a blank database; for a connection
		// string, one that names no database.
		this._serverMode = _config.kind === 'connectionString'
			? !connectionStringHasDatabase(_config.connectionString)
			: !_config.database;

		// The base client. In server mode it connects to the maintenance database to enumerate the
		// databases on the server; otherwise it connects to the single configured database.
		this._client = this._serverMode ? this._buildClient(MAINTENANCE_DATABASE) : this._buildClient();
	}

	/**
	 * Builds a reconnecting client, optionally scoped to a specific database (used to create
	 * per-database clients in server mode). The returned wrapper rebuilds its underlying pg client from
	 * the same config on reconnect.
	 */
	private _buildClient(database?: string): PostgreSQLClient {
		return new PostgreSQLClient(() => this._buildPgClient(database));
	}

	/**
	 * Builds the underlying pg client from the connection config, optionally scoped to a specific
	 * database. A connection string is parsed and applied by the pg client itself (including SSL);
	 * otherwise the client is built from the individual fields. TCP keepalive is enabled so an idle
	 * socket stays warm and a dead peer is detected quickly.
	 */
	private _buildPgClient(database?: string): Client {
		// Keep the socket warm across idle gaps and let the OS detect a dead peer quickly.
		const keepAlive = { keepAlive: true, keepAliveInitialDelayMillis: KEEP_ALIVE_INITIAL_DELAY_MS };
		if (this._config.kind === 'connectionString') {
			const connectionString = database !== undefined
				? withConnectionStringDatabase(this._config.connectionString, database)
				: this._config.connectionString;
			return new Client({ connectionString, ...keepAlive });
		}
		return new Client({
			host: this._config.host,
			port: this._config.port,
			user: this._config.user,
			password: this._config.password,
			database: database ?? this._config.database,
			ssl: buildSslConfig(this._config),
			...keepAlive,
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
			// In server mode the base client targets the maintenance database; if that is unavailable
			// (it doesn't exist, or the role can't connect to it), fall back to the pg client's default
			// database (the user name) so enumeration still works. Any other failure is terminal.
			if (this._serverMode) {
				try { await this._client.end(); } catch { /* the client never connected; nothing to close */ }
				this._client = this._buildClient();
				try {
					await this._client.connect();
					return;
				} catch (fallbackErr: any) {
					this._client = null;
					throw this._connectError(fallbackErr);
				}
			}
			this._client = null;
			throw this._connectError(err);
		}
	}

	/**
	 * Builds the error thrown when the base client fails to connect, naming what we tried to connect
	 * to. A connection string hides the host; a socket-directory host (or no host) means a local-socket
	 * connection; otherwise the host:port is reported.
	 */
	private _connectError(err: any): Error {
		let target: string;
		if (this._config.kind === 'connectionString') {
			target = 'the server in the connection string';
		} else if (this._config.host && !this._config.host.startsWith('/')) {
			target = `${this._config.host}:${this._config.port ?? 5432}`;
		} else {
			target = 'the local socket';
		}
		return new Error(`Failed to connect to PostgreSQL at ${target}: ${err.message}`);
	}

	/**
	 * Gets a value which indicates whether the connection is read only. PostgreSQL connections are
	 * always read/write; read-only is not exposed as a connection parameter.
	 */
	async isReadOnly(): Promise<boolean> {
		return false;
	}

	/**
	 * Returns top-level children. In server mode (no database specified) this is a single "Databases"
	 * group that lists the databases on the server, each expanding to its schemas. Otherwise it is a
	 * single "Schemas" group that lists every non-system schema in the connected database.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		if (this._serverMode) {
			return [createDatabasesGroupNode(this)];
		}
		return [createSchemasGroupNode(this._client!, this, undefined)];
	}

	/**
	 * Lists the browsable databases on the server (excluding templates and databases that don't allow
	 * connections). Used by the "Databases" group in server mode.
	 */
	async listDatabases(): Promise<string[]> {
		this._ensureConnected();
		const result = await this._client!.query(
			`SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname`
		);
		return result.rows.map(row => row.datname);
	}

	/**
	 * Returns a pg client connected to the given database, creating and caching it on first use so a
	 * database node's schemas can be browsed with a client scoped to that database. The cached clients
	 * are closed on disconnect.
	 */
	async getDatabaseClient(database: string): Promise<PostgreSQLClient> {
		this._ensureConnected();
		let clientPromise = this._databaseClients.get(database);
		if (!clientPromise) {
			clientPromise = (async () => {
				const client = this._buildClient(database);
				await client.connect();
				return client;
			})();
			// Cache the promise before awaiting so concurrent calls share it. If the connection fails,
			// drop it from the cache so a later expansion can retry.
			this._databaseClients.set(database, clientPromise);
			try {
				await clientPromise;
			} catch (err) {
				this._databaseClients.delete(database);
				throw err;
			}
		}
		return clientPromise;
	}

	/**
	 * Opens the given table or view in the Data Explorer. Registers a table view with the RPC
	 * handler under a stable per-connection dataset id, then asks Positron to open (or focus) the
	 * explorer backed by this extension's provider. `client` is the client the object's node was built
	 * against and `database` is the database it lives in (undefined in single-database mode), so the
	 * dataset id and query client match the right database.
	 */
	async previewObject(client: PostgreSQLClient, database: string | undefined, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void> {
		this._ensureConnected();
		const datasetId = `postgresql:${this._connectionId}:${database ?? ''}:${kind}:${schemaName}.${tableName}`;
		await this._dataExplorerHandler.openTableView(datasetId, this._queryClient(client), schemaName, tableName, kind);
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
	async previewColumn(client: PostgreSQLClient, database: string | undefined, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void> {
		this._ensureConnected();
		const datasetId = `postgresql:${this._connectionId}:${database ?? ''}:column:${schemaName}.${tableName}.${columnName}`;
		await this._dataExplorerHandler.openColumnView(datasetId, this._queryClient(client), schemaName, tableName, kind, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: POSTGRESQL_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: `${tableName}.${columnName}`,
		});
	}

	/** A query client over the given pg client, for the Data Explorer table views. */
	private _queryClient(client: PostgreSQLClient) {
		return { runQuery: async (sql: string) => (await client.query(sql)).rows };
	}

	/** Closes the connection and releases any previewed table views. Idempotent. */
	async disconnect(): Promise<void> {
		for (const datasetId of this._openedDatasets) {
			this._dataExplorerHandler.closeTableView(datasetId);
		}
		this._openedDatasets.clear();
		// Close any per-database clients created in server mode. Await each settled promise so a client
		// that connected is ended; ignore failures from clients that never connected.
		const databaseClients = [...this._databaseClients.values()];
		this._databaseClients.clear();
		await Promise.all(databaseClients.map(async clientPromise => {
			try {
				await (await clientPromise).end();
			} catch {
				// The client failed to connect or has already ended; nothing to close.
			}
		}));
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
