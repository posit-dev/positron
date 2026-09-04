/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Amazon Redshift speaks the PostgreSQL wire protocol, so the `pg` client connects to it directly.
// This driver was cloned from positron-data-driver-postgresql, but Redshift connections are always
// scoped to a single database (you must name a database to connect to a cluster), so the Postgres
// "server mode" that enumerates databases via the `postgres` maintenance database is intentionally
// absent here. The top-level nodes are always the schemas of the connected database.

import * as positron from 'positron';
import * as vscode from 'vscode';
import { isAuthenticationError, PgClientFactory, RedshiftClient, RedshiftFieldConfig } from './redshiftClient.js';
import { createIamCredentialProvider, RedshiftCredentialFetcher, RedshiftIamConfig } from './redshiftIamCredentials.js';
import { createDatabasesGroupNode, createSchemasGroupNode, IRedshiftPreviewHost } from './redshiftNodes.js';
import { IRedshiftDataExplorerHost, REDSHIFT_DATA_EXPLORER_PROVIDER_ID } from './redshiftDataExplorerRpcHandler.js';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/**
 * Connection configuration passed from the driver. `fields` is a user-supplied host, user, and
 * password; `iam` carries the AWS target instead, and the user and password are minted from the
 * caller's IAM identity on each connect. The `kind` discriminant also leaves room for a
 * connection-string form later without changing callers.
 */
export type RedshiftConnectionConfig =
	| ({ kind: 'fields' } & RedshiftFieldConfig)
	| ({ kind: 'iam'; iam: RedshiftIamConfig } & RedshiftFieldConfig);

/**
 * The connection's outward-facing dependencies. Both default to the real implementations; a test
 * supplies fakes so the whole chain -- config to credential provider to pg client -- runs without a
 * cluster or an AWS account.
 */
export interface RedshiftConnectionDependencies {
	/** Builds the underlying pg client. */
	pgClientFactory?: PgClientFactory;
	/** Mints IAM credentials. Ignored for a `fields` connection. */
	credentialFetcher?: RedshiftCredentialFetcher;
}

/**
 * A live Amazon Redshift connection implementing the DataConnection interface. Connects via a
 * reconnecting pg client and provides schema browsing via getChildren(), always scoped to the single
 * configured database.
 */
export class RedshiftConnection implements positron.DataConnection, IRedshiftPreviewHost {
	// The reconnecting pg client, or null after disconnect.
	private _client: RedshiftClient | null;

	// Whether the cluster supports cross-database queries (RA3 / Serverless). Detected on connect;
	// when true, the top-level nodes are the databases in the namespace rather than the schemas of
	// the single connected database.
	private _crossDatabase = false;

	// Unique id for this connection, used to key its previewed datasets.
	private readonly _connectionId = `redshift-${nextConnectionId++}`;

	// Dataset ids opened via the preview methods, so they can be released on disconnect.
	private readonly _openedDatasets = new Set<string>();

	/**
	 * Constructor. Call connect() after constructing to establish the connection.
	 * @param _config The connection configuration.
	 * @param _dataExplorerHandler Hosts table views previewed in the Data Explorer.
	 * @param _logger Optional diagnostic log sink for connection lifecycle and query events.
	 * @param _options Overrides for the two dependencies that reach outside the process, so tests
	 * can exercise the real wiring -- including the IAM credential path -- without a cluster or an
	 * AWS account.
	 */
	constructor(
		private readonly _config: RedshiftConnectionConfig,
		private readonly _dataExplorerHandler: IRedshiftDataExplorerHost,
		private readonly _logger?: positron.DataConnectionLogger,
		private readonly _options?: RedshiftConnectionDependencies
	) {
		// Under IAM the credentials are minted per connect rather than configured, so hand the client
		// a provider instead of a password.
		this._client = new RedshiftClient(
			this._config.kind === 'iam'
				? {
					...this._config,
					credentialProvider: createIamCredentialProvider(
						this._config.iam, this._logger, this._options?.credentialFetcher),
				}
				: this._config,
			this._options?.pgClientFactory);
	}

	/** Establishes the connection. Must be called before any other method. */
	async connect(): Promise<void> {
		if (!this._client) {
			throw new Error('Redshift connection has been disconnected');
		}
		// Under IAM there is no user to name yet: AWS derives it from the federated identity and
		// returns it during connect, so it is only known afterwards.
		const target = `${this._config.host}:${this._config.port}/${this._config.database}`;
		this._logger?.info(this._config.kind === 'iam'
			? `Connecting to ${target} with AWS IAM credentials`
			: `Connecting to ${target} as ${this._config.user}`);
		try {
			await this._client.connect();
		} catch (err: any) {
			this._client = null;
			const error = new Error(`Failed to connect to Redshift at ${this._config.host}:${this._config.port}: ${err.message}${this._missingDatabaseUserHint(err)}`);
			this._logger?.error(error.message);
			throw error;
		}
		// Detect cross-database support once the connection is up. A failure here is non-fatal: the
		// connection still works, it just browses the single connected database.
		this._crossDatabase = await this._detectCrossDatabase();
		const connectedAs = this._client.resolvedUser;
		this._logger?.info(`Connected to ${this._config.host}:${this._config.port}${connectedAs ? ` as ${connectedAs}` : ''} (cross-database ${this._crossDatabase ? 'available' : 'unavailable'})`);
	}

	/**
	 * Extra guidance for the one provisioned-cluster failure that is predictable.
	 *
	 * With AutoCreate off -- the AWS default, and what this driver asks for so that connecting never
	 * silently creates a database user -- GetClusterCredentials *succeeds* for a user that does not
	 * exist, and the login is what fails. So the cause is an AWS-side decision but the symptom is a
	 * bare authentication error from Postgres, which points nowhere useful. Under IAM the password
	 * was minted rather than typed, so an authentication failure cannot be a wrong password: the
	 * identity simply is not a user in the database.
	 *
	 * Returns an empty string when the failure is anything else, so the message is unchanged.
	 */
	private _missingDatabaseUserHint(err: unknown): string {
		if (this._config.kind !== 'iam' || this._config.iam.kind !== 'provisioned') {
			return '';
		}
		// Same predicate the client uses to decide a credential was rejected, so the retry set and
		// this hint cannot drift apart.
		if (!isAuthenticationError(err)) {
			return '';
		}
		return ' ' + vscode.l10n.t(
			"The IAM credentials were issued, but the database user '{0}' may not exist in cluster '{1}'. Redshift does not create it. Create the user in the database, or use a database user that already exists.",
			this._config.iam.dbUser ?? '', this._config.iam.name);
	}

	/**
	 * Probes for cross-database query support by reading the SVV_REDSHIFT_DATABASES catalog view,
	 * which exists only where cross-database queries are available (RA3 clusters and Serverless).
	 * Returns false on any error (e.g. the view is missing on DC2 clusters, or is not permitted).
	 */
	private async _detectCrossDatabase(): Promise<boolean> {
		try {
			await this._client!.query('SELECT 1 FROM SVV_REDSHIFT_DATABASES LIMIT 1');
			return true;
		} catch {
			return false;
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
	 * Returns top-level children. When the cluster supports cross-database queries, this is a single
	 * "Databases" group listing every database in the namespace; otherwise it is a single "Schemas"
	 * group listing the non-system schemas of the connected database.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		if (this._crossDatabase) {
			return [createDatabasesGroupNode(this._client!, this)];
		}
		return [createSchemasGroupNode(this._client!, this)];
	}

	/**
	 * Opens the given table or view in the Data Explorer. Registers a table view with the RPC handler
	 * under a stable per-connection dataset id, then asks Positron to open (or focus) the explorer
	 * backed by this extension's provider. Returns the dataset id it was opened under, which Positron
	 * uses to tell that this connection has a Data Explorer open on it.
	 */
	async previewObject(client: RedshiftClient, database: string | undefined, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<string> {
		this._ensureConnected();
		const datasetId = `redshift:${this._connectionId}:${database ?? ''}:${kind}:${schemaName}.${tableName}`;
		await this._dataExplorerHandler.openTableView(datasetId, this._queryClient(client), database, schemaName, tableName, kind);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: REDSHIFT_DATA_EXPLORER_PROVIDER_ID,
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
	async previewColumn(client: RedshiftClient, database: string | undefined, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<string> {
		this._ensureConnected();
		const datasetId = `redshift:${this._connectionId}:${database ?? ''}:column:${schemaName}.${tableName}.${columnName}`;
		await this._dataExplorerHandler.openColumnView(datasetId, this._queryClient(client), database, schemaName, tableName, kind, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: REDSHIFT_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: `${tableName}.${columnName}`,
		});
		return datasetId;
	}

	/** A query client over the given pg client, for the Data Explorer table views. */
	private _queryClient(client: RedshiftClient) {
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
