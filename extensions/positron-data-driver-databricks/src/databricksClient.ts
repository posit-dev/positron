/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A reconnecting wrapper around the @databricks/sql driver. It mirrors the reconnecting client the
// Snowflake driver uses, adapted to three ways Databricks differs:
//
//   1. Two objects, not one. The SDK splits a connection into a client (transport + auth) and a
//      session (the server-side SQL context). Both are created here and torn down together, so the
//      rest of the driver still sees a single `connect()`/`query()`/`end()` surface.
//
//   2. Statements are operations. `executeStatement` hands back a handle whose rows are fetched
//      separately and which must be closed to release server resources. `query()` owns that whole
//      lifecycle, closing the operation even when fetching throws.
//
//   3. Session expiry. A Databricks session is dropped when the warehouse is stopped, restarted, or
//      the session times out; the next statement then fails with an invalid session handle. query()
//      classifies that failure and rebuilds the client and session once before retrying, so
//      browsing a connection that sat idle recovers transparently. A genuine SQL error (unknown
//      table, parse error) is never retried.

import { DBSQLClient } from '@databricks/sql';

/** How the connection authenticates. Each value maps to a distinct @databricks/sql auth config. */
export type DatabricksAuthType =
	/** Personal access token, supplied as a bearer token. */
	| 'pat'
	/** OAuth user-to-machine: the SDK opens the system browser to complete sign-in. */
	| 'u2m'
	/** OAuth machine-to-machine: a service principal's client id and secret. */
	| 'm2m';

/**
 * Normalized Databricks connection options, independent of any single auth mechanism. Built by the
 * driver from the selected mechanism's parameter values. Only the fields relevant to a mechanism are
 * set; the rest are left undefined.
 */
export interface DatabricksConnectionOptions {
	/** The workspace hostname, without a scheme (e.g. `dbc-abc123.cloud.databricks.com`). */
	host: string;
	/** The compute resource's HTTP path (e.g. `/sql/1.0/warehouses/abc123def456`). */
	httpPath: string;
	/** Which auth flow to use. */
	authType: DatabricksAuthType;
	/** The personal access token (PAT auth). */
	token?: string;
	/** The service principal's client id (M2M auth). */
	clientId?: string;
	/** The service principal's client secret (M2M auth). */
	clientSecret?: string;
	/** The initial current catalog. Optional. */
	catalog?: string;
	/** The initial current schema. Optional. */
	schema?: string;
}

/** The shape a query resolves to: rows as plain objects keyed by column name. */
export interface DatabricksQueryResult {
	rows: Array<Record<string, unknown>>;
}

/**
 * The slice of the SDK's operation surface this client uses. Declared locally (rather than imported
 * from the SDK's `IOperation`) so a test can supply a fake without a live warehouse.
 */
export interface IDatabricksOperation {
	/** Fetches every row of the result, as objects keyed by column name. */
	fetchAll(): Promise<Array<object>>;
	/** Releases the operation's server-side resources. */
	close(): Promise<unknown>;
}

/** The slice of the SDK's session surface this client uses. */
export interface IDatabricksSession {
	/** Submits a statement and returns a handle to its result. */
	executeStatement(statement: string, options?: { runAsync?: boolean }): Promise<IDatabricksOperation>;
	/**
	 * Lists relations through the JDBC-style metadata API, which takes the catalog as a parameter
	 * rather than as part of a SQL identifier. `catalogName` is matched exactly; `schemaName` and
	 * `tableName` are SQL LIKE patterns.
	 */
	getTables(request: { catalogName?: string; schemaName?: string; tableName?: string }): Promise<IDatabricksOperation>;
	/** Closes the session. */
	close(): Promise<unknown>;
}

/** Submits work on a session and hands back the handle to its result. */
type OperationOpener = (session: IDatabricksSession) => Promise<IDatabricksOperation>;

/** The slice of the SDK's client surface this client uses. */
export interface IDatabricksSdkClient {
	/** Establishes the transport and authenticates. */
	connect(options: Record<string, unknown>): Promise<unknown>;
	/** Opens a SQL session, optionally with an initial catalog and schema. */
	openSession(request?: { initialCatalog?: string; initialSchema?: string }): Promise<IDatabricksSession>;
	/** Tears down the transport. */
	close(): Promise<void>;
}

/**
 * Builds a fresh SDK client. Factored out (and overridable via the DatabricksClient constructor) so
 * tests can supply a fake client without a live workspace.
 */
export type DatabricksSdkClientFactory = () => IDatabricksSdkClient;

/** The real factory: a stock DBSQLClient. */
const defaultClientFactory: DatabricksSdkClientFactory = () =>
	// DBSQLClient's connect() takes a discriminated union of auth shapes that this file assembles
	// dynamically (see connectionOptions), so the boundary is cast to the narrower local interface.
	new DBSQLClient() as unknown as IDatabricksSdkClient;

/**
 * Translates normalized options into the @databricks/sql connect options for the chosen auth flow.
 * Exported for unit tests, which assert the mapping without opening a connection.
 */
export function connectionOptions(options: DatabricksConnectionOptions): Record<string, unknown> {
	const base: Record<string, unknown> = {
		host: options.host,
		path: options.httpPath,
		// Identifies Positron in the workspace's query history and audit logs.
		userAgentEntry: 'Positron',
		// Return DECIMAL columns as exact strings and BIGINT as bigint rather than coercing both to a
		// JS number, which silently rounds values beyond 2^53. The table view formats these for
		// display, so exactness here is free and prevents wrong cell values in wide-integer columns.
		preserveBigNumericPrecision: true,
		// Positron does not forward usage telemetry to Databricks on the user's behalf. Queries are
		// still recorded in the workspace's own query history, which is the workspace admin's to see.
		telemetryEnabled: false,
	};
	switch (options.authType) {
		case 'pat':
			return { ...base, token: options.token };
		case 'u2m':
			// The SDK runs the OAuth authorization-code flow: it opens the system browser and listens
			// on a loopback redirect for the result.
			return { ...base, authType: 'databricks-oauth' };
		case 'm2m':
			// Supplying a client id and secret switches the same OAuth path to the client-credentials
			// grant, with no browser interaction.
			return {
				...base,
				authType: 'databricks-oauth',
				oauthClientId: options.clientId,
				oauthClientSecret: options.clientSecret,
			};
	}
}

// Connect-retry budget. A SQL warehouse that is starting up, or a transient network hiccup, can drop
// the first connect attempts; the attempt count and capped exponential backoff cover a brief window
// before giving up. A terminal error (bad token, unknown workspace) is not retried.
const CONNECT_MAX_ATTEMPTS = 5;
const CONNECT_RETRY_BASE_DELAY_MS = 1_000;
const CONNECT_RETRY_MAX_DELAY_MS = 10_000;

/** Resolves after the given number of milliseconds. */
function defaultSleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/** An error as surfaced by the SDK or the underlying socket: may carry a code and a message. */
interface DatabricksError {
	code?: string | number;
	message?: string;
}

/**
 * Whether an error means the session or transport itself is gone (as opposed to a SQL-level error
 * like a parse failure or a missing table, which reconnecting would not fix). Covers Node socket
 * errors and the message-only session errors the SDK raises once its session has been dropped --
 * which happens routinely when the warehouse is stopped or restarted between statements. Only these
 * trigger a reconnect, so a genuine query error is never retried.
 */
export function isFatalConnectionError(err: unknown): boolean {
	if (!err || typeof err !== 'object') {
		return false;
	}
	const { code, message } = err as DatabricksError;
	if (typeof code === 'string') {
		// Node socket-level errors.
		if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT' ||
			code === 'ECONNREFUSED' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH' ||
			code === 'EHOSTDOWN') {
			return true;
		}
	}
	const lower = (message ?? '').toLowerCase();
	return lower.includes('invalid sessionhandle') ||
		lower.includes('session is closed') ||
		lower.includes('session does not exist') ||
		lower.includes('session handle') ||
		lower.includes('socket hang up') ||
		lower.includes('network error') ||
		lower.includes('econnreset') ||
		lower.includes('terminated');
}

/**
 * A Databricks connection that survives its session being dropped. Presents the small surface the
 * rest of the driver uses -- connect(), query(), end() -- and swaps the underlying client and
 * session transparently when a statement hits a dead session. Callers hold a stable reference to
 * this wrapper, so schema-tree nodes built against it keep working across a reconnect.
 */
export class DatabricksClient {
	// The current SDK client and its session, or null before connect() / after end(). The two are
	// created and discarded together: a session cannot outlive its client's transport.
	private _client: IDatabricksSdkClient | null = null;
	private _session: IDatabricksSession | null = null;

	// In-flight reconnect, shared so concurrent queries that all hit the dead session rebuild once
	// rather than racing to create several. While it is set, `_session` is transiently null even
	// though the client is not closed, so callers must await it before reading `_session`.
	private _reconnecting: Promise<void> | null = null;

	// True once end() has been called. Distinguishes a disposed client (a null `_session` that stays
	// null) from a client mid-reconnect (a null `_session` that a pending `_reconnecting` will
	// refill), so a query in the reconnect window waits instead of failing as "closed".
	private _closed = false;

	/**
	 * @param _config The connection options.
	 * @param _createClient Factory for the underlying SDK client. Defaults to a real DBSQLClient;
	 * overridden in tests to supply a fake.
	 * @param _sleep Backoff delay between connect attempts. Overridden in tests to avoid real waits.
	 */
	constructor(
		private readonly _config: DatabricksConnectionOptions,
		private readonly _createClient: DatabricksSdkClientFactory = defaultClientFactory,
		private readonly _sleep: (ms: number) => Promise<void> = defaultSleep
	) { }

	/**
	 * Builds a client and session, retrying a transient failure with backoff. A terminal error (bad
	 * token, unknown workspace) or exhausting the attempts propagates.
	 */
	private async _open(): Promise<void> {
		for (let attempt = 1; ; attempt++) {
			const client = this._createClient();
			try {
				await client.connect(connectionOptions(this._config));
				this._session = await client.openSession({
					initialCatalog: this._config.catalog,
					initialSchema: this._config.schema,
				});
				this._client = client;
				return;
			} catch (err) {
				// The client may hold an open transport even when opening the session failed; drop it
				// before the next attempt so a retry doesn't leak the previous one.
				await client.close().catch(() => { /* nothing to clean up */ });
				if (!isFatalConnectionError(err) || attempt >= CONNECT_MAX_ATTEMPTS) {
					throw err;
				}
				await this._sleep(Math.min(CONNECT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), CONNECT_RETRY_MAX_DELAY_MS));
			}
		}
	}

	/** Establishes the connection. Must be called before query(). */
	async connect(): Promise<void> {
		await this._open();
	}

	/**
	 * Runs a query, reconnecting once and retrying if the session was found dead. A non-connection
	 * error (bad SQL, missing table) is thrown without a retry.
	 */
	async query(sqlText: string): Promise<DatabricksQueryResult> {
		return this._run(session => session.executeStatement(sqlText, { runAsync: true }));
	}

	/**
	 * Lists the relations in a schema through the metadata API, with the same reconnect-and-retry
	 * semantics as `query`. Rows come back in the JDBC `getTables` shape (TABLE_CAT, TABLE_SCHEM,
	 * TABLE_NAME, TABLE_TYPE, ...).
	 *
	 * This is deliberately not a `SHOW TABLES` / `SHOW VIEWS` statement: those name the schema as a SQL
	 * identifier, and Databricks rejects a two-part `catalog.schema` reference in those commands unless
	 * that catalog is the session's current one (CROSS_CATALOG_SCHEMA_REFERENCE_NOT_SUPPORTED). The
	 * metadata API takes the catalog as a parameter instead, so browsing every catalog from one session
	 * works without mutating session state.
	 *
	 * @param catalog The catalog to list in. Matched exactly.
	 * @param schemaPattern The schema to list. A SQL LIKE pattern, so callers must filter the results
	 *   for exactness (see databricksNodes.ts).
	 */
	async listTables(catalog: string, schemaPattern: string): Promise<DatabricksQueryResult> {
		return this._run(session => session.getTables({ catalogName: catalog, schemaName: schemaPattern }));
	}

	/**
	 * Runs an operation, reconnecting once and retrying if the session was found dead. A non-connection
	 * error (bad SQL, missing table) is thrown without a retry.
	 */
	private async _run(open: OperationOpener): Promise<DatabricksQueryResult> {
		// A reconnect nulls `_session` while it rebuilds; wait for any in-flight reconnect rather than
		// mistaking that transient gap for a closed client.
		const inflight = this._reconnecting;
		if (inflight) {
			await inflight;
		}
		if (this._closed) {
			throw new Error('Databricks client is closed');
		}
		try {
			return await this._runOnce(open);
		} catch (err) {
			if (!isFatalConnectionError(err)) {
				throw err;
			}
			await this._reconnect();
			return await this._runOnce(open);
		}
	}

	/**
	 * Opens a single operation on the current session and collects its rows. The operation is always
	 * closed, even when fetching fails, so a failed query does not leak server-side state.
	 */
	private async _runOnce(open: OperationOpener): Promise<DatabricksQueryResult> {
		const session = this._session;
		if (!session) {
			throw new Error('Databricks client is closed');
		}
		const operation = await open(session);
		try {
			const rows = await operation.fetchAll();
			return { rows: rows as Array<Record<string, unknown>> };
		} finally {
			await operation.close().catch(() => { /* the operation is done with either way */ });
		}
	}

	/**
	 * Rebuilds the client and session after a dead-session failure. Coalesced so concurrent callers
	 * share one reconnect; the old client is torn down best-effort (its session has already gone, so
	 * failures to close it are expected and ignored).
	 */
	private _reconnect(): Promise<void> {
		if (this._closed) {
			return Promise.reject(new Error('Databricks client is closed'));
		}
		if (!this._reconnecting) {
			this._reconnecting = (async () => {
				await this._teardown();
				await this._open();
				// If end() ran while we were rebuilding, don't leave the freshly opened client
				// installed: tear it down so a disposed client holds no live session.
				if (this._closed) {
					await this._teardown();
				}
			})().finally(() => { this._reconnecting = null; });
		}
		return this._reconnecting;
	}

	/** Closes the connection. Idempotent. */
	async end(): Promise<void> {
		this._closed = true;
		// If a reconnect is mid-flight, let it settle first: it owns the client and session and will
		// hand back whatever it installs (its own closed-check then tears that down), so awaiting it
		// avoids racing a live session into place after we return.
		const inflight = this._reconnecting;
		if (inflight) {
			await inflight.catch(() => { /* a failed reconnect leaves nothing to close */ });
		}
		await this._teardown();
	}

	/** Discards the current session and client, ignoring teardown failures. */
	private async _teardown(): Promise<void> {
		const session = this._session;
		const client = this._client;
		this._session = null;
		this._client = null;
		if (session) {
			await session.close().catch(() => { /* already gone; nothing more to do */ });
		}
		if (client) {
			await client.close().catch(() => { /* already gone; nothing more to do */ });
		}
	}
}
