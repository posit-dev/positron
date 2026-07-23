/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A reconnecting wrapper around the snowflake-sdk Connection. It mirrors the reconnecting client the
// Redshift driver uses, but adapts to two ways Snowflake differs from a raw Postgres socket:
//
//   1. Callbacks, not promises. snowflake-sdk is callback-based -- connect(cb), execute({complete}),
//      destroy(cb) -- so each call is promisified here, giving the rest of the driver the same
//      `query()`/`connect()`/`end()` surface the Postgres/Redshift clients expose.
//
//   2. Session drop-out. A Snowflake session left idle is torn down server-side (the client session
//      idle timeout), and the socket can also be dropped by a NAT/firewall along the way. The next
//      query then fails with a session/connection error. `clientSessionKeepAlive` keeps the session
//      warm across ordinary gaps; when the session really is gone, query() classifies the failure and
//      rebuilds the connection once before retrying, so browsing a connection that sat idle recovers
//      transparently. A genuine SQL error (bad identifier, compilation error) is never retried.

import * as snowflake from 'snowflake-sdk';

/**
 * Normalized Snowflake connection options, independent of any single auth mechanism. Built by the
 * driver from the mechanism's parameter values and passed straight to snowflake-sdk's
 * createConnection. Only the fields relevant to a mechanism are set; the rest are left undefined.
 */
export interface SnowflakeConnectionOptions {
	/** The Snowflake account identifier (e.g. `myorg-myacct`), never the full hostname. */
	account: string;
	/** The login name. Required for key-pair and PAT; optional for OAuth client credentials. */
	username?: string;
	/**
	 * The password field. Also carries a Programmatic Access Token, which Snowflake accepts wherever a
	 * password is expected, so PAT auth sets this and leaves `authenticator` at its default.
	 */
	password?: string;
	/** The snowflake-sdk authenticator constant (e.g. `SNOWFLAKE_JWT`, `OAUTH_CLIENT_CREDENTIALS`). */
	authenticator?: string;
	/** Path to the PEM private key file (key-pair / SNOWFLAKE_JWT auth). */
	privateKeyPath?: string;
	/** Passphrase protecting the private key file, if any (key-pair auth). */
	privateKeyPass?: string;
	/** OAuth client id (OAuth client-credentials auth). */
	oauthClientId?: string;
	/** OAuth client secret (OAuth client-credentials auth). */
	oauthClientSecret?: string;
	/** OAuth token endpoint the client-credentials grant posts to. */
	oauthTokenRequestUrl?: string;
	/** OAuth scope requested for the token, if any. */
	oauthScope?: string;
	/** The warehouse to use for queries. Optional; the account default is used when unset. */
	warehouse?: string;
	/** The initial current database. Optional. */
	database?: string;
	/** The initial current schema. Optional. */
	schema?: string;
	/** The role to activate for the session. Optional. */
	role?: string;
}

/** An error as surfaced by snowflake-sdk or the underlying socket: may carry a code and a message. */
interface SnowflakeError {
	code?: string | number;
	message?: string;
}

/** The options passed to snowflake-sdk's Connection.execute. */
interface SdkExecuteOptions {
	sqlText: string;
	binds?: unknown[];
	complete: (err: SnowflakeError | undefined, stmt: unknown, rows: Array<Record<string, unknown>> | undefined) => void;
}

/**
 * The slice of the snowflake-sdk Connection surface this client uses. Declared locally (rather than
 * pulled from @types/snowflake-sdk, which lags the SDK and lacks the newer auth options) so the
 * factory can be faked in tests without a live account.
 */
export interface ISnowflakeSdkConnection {
	/** Connects using a synchronous authenticator (password, key-pair, PAT). */
	connect(callback: (err: SnowflakeError | undefined, conn: ISnowflakeSdkConnection) => void): void;
	/**
	 * Connects using an authenticator that needs an async step (OAuth token exchange, browser SSO).
	 * This is the SDK's promise-based API: it returns a promise that settles with the outcome, and
	 * depending on the failure mode it may reject that promise *without* invoking the callback. Callers
	 * must therefore consume the returned promise, not rely on the callback alone.
	 */
	connectAsync(callback?: (err: SnowflakeError | undefined, conn: ISnowflakeSdkConnection) => void): Promise<ISnowflakeSdkConnection>;
	/** Runs a statement, delivering rows (or an error) to the `complete` callback. */
	execute(options: SdkExecuteOptions): void;
	/** Closes the connection. */
	destroy(callback: (err: SnowflakeError | undefined, conn: ISnowflakeSdkConnection) => void): void;
}

/** The shape a query resolves to: rows as plain objects keyed by (case-preserved) column name. */
export interface SnowflakeQueryResult {
	rows: Array<Record<string, unknown>>;
}

/**
 * Builds a fresh snowflake-sdk Connection for the given options. Factored out (and overridable via
 * the SnowflakeClient constructor) so tests can supply a fake connection without a live account.
 */
export type SnowflakeConnectionFactory = (options: SnowflakeConnectionOptions) => ISnowflakeSdkConnection;

/**
 * Authenticators whose connect performs an asynchronous step (an OAuth token exchange or a browser
 * round-trip) and so must go through snowflake-sdk's connectAsync rather than connect.
 */
const ASYNC_AUTHENTICATORS = new Set(['OAUTH_CLIENT_CREDENTIALS', 'OAUTH_AUTHORIZATION_CODE', 'EXTERNALBROWSER']);

/** The real factory: a keepalive-enabled snowflake-sdk Connection. */
const defaultConnectionFactory: SnowflakeConnectionFactory = options => {
	// createConnection returns @types/snowflake-sdk's Connection, whose execute signature is narrower
	// than the simplified ISnowflakeSdkConnection this file declares (see that interface's comment).
	// Cast at the SDK boundary since the two execute shapes aren't structurally assignable.
	return snowflake.createConnection({
		account: options.account,
		username: options.username,
		password: options.password,
		authenticator: options.authenticator,
		privateKeyPath: options.privateKeyPath,
		privateKeyPass: options.privateKeyPass,
		oauthClientId: options.oauthClientId,
		oauthClientSecret: options.oauthClientSecret,
		oauthTokenRequestUrl: options.oauthTokenRequestUrl,
		oauthScope: options.oauthScope,
		warehouse: options.warehouse,
		database: options.database,
		schema: options.schema,
		role: options.role,
		// Keep the session warm across idle gaps so browsing after a pause doesn't hit a torn-down
		// session on the first query.
		clientSessionKeepAlive: true,
		// Identify Positron as the client application in Snowflake's session metadata.
		application: 'Positron',
	}) as unknown as ISnowflakeSdkConnection;
};

// Connect-retry budget. A transient network hiccup or a warehouse still spinning up can drop the
// first connect attempts; the attempt count and capped exponential backoff cover a brief window
// before giving up. A terminal error (bad credentials, unknown account) is not retried.
const CONNECT_MAX_ATTEMPTS = 5;
const CONNECT_RETRY_BASE_DELAY_MS = 1_000;
const CONNECT_RETRY_MAX_DELAY_MS = 10_000;

/** Resolves after the given number of milliseconds. */
function defaultSleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Whether an error means the session/connection itself is gone (as opposed to a SQL-level error like
 * a compilation or object-not-found problem, which reconnecting would not fix). Covers Node socket
 * errors and the message-only network/session errors snowflake-sdk raises when its session has been
 * torn down. Only these trigger a reconnect, so a genuine query error is never retried.
 */
export function isFatalConnectionError(err: unknown): boolean {
	if (!err || typeof err !== 'object') {
		return false;
	}
	const { code, message } = err as SnowflakeError;
	if (typeof code === 'string') {
		// Node socket-level errors.
		if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT' ||
			code === 'ECONNREFUSED' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH' ||
			code === 'EHOSTDOWN') {
			return true;
		}
	}
	// snowflake-sdk raises these (with no SQL state) once its session/socket has gone away.
	const lower = (message ?? '').toLowerCase();
	return lower.includes('terminated') ||
		lower.includes('network error') ||
		lower.includes('socket hang up') ||
		lower.includes('session does not exist') ||
		lower.includes("session doesn't exist") ||
		lower.includes('session token') ||
		lower.includes('not connected');
}

/**
 * A snowflake-sdk connection that survives an idle session dropping out from under it. Presents the
 * small promisified surface the rest of the driver uses -- connect(), query(), end() -- and swaps the
 * underlying connection transparently when a query hits a dead session. Callers hold a stable
 * reference to this wrapper, so schema-tree nodes built against it keep working across a reconnect.
 */
export class SnowflakeClient {
	// The current sdk connection, or null before connect() / after end().
	private _conn: ISnowflakeSdkConnection | null = null;

	// In-flight reconnect, shared so concurrent queries that all hit the dead session rebuild the
	// connection once rather than racing to create several.
	private _reconnecting: Promise<void> | null = null;

	/**
	 * @param _config The connection options.
	 * @param _createConnection Factory for the underlying sdk connection. Defaults to a
	 * keepalive-enabled real connection; overridden in tests to supply a fake.
	 * @param _sleep Backoff delay between connect attempts. Overridden in tests to avoid real waits.
	 */
	constructor(
		private readonly _config: SnowflakeConnectionOptions,
		private readonly _createConnection: SnowflakeConnectionFactory = defaultConnectionFactory,
		private readonly _sleep: (ms: number) => Promise<void> = defaultSleep
	) { }

	/**
	 * Builds a connection and connects it, retrying a transient connection failure with backoff. A
	 * terminal error (bad credentials, unknown account) or exhausting the attempts propagates.
	 */
	private async _open(): Promise<void> {
		for (let attempt = 1; ; attempt++) {
			const conn = this._createConnection(this._config);
			try {
				await this._connectOnce(conn);
				this._conn = conn;
				return;
			} catch (err) {
				if (!isFatalConnectionError(err) || attempt >= CONNECT_MAX_ATTEMPTS) {
					throw err;
				}
				await this._sleep(Math.min(CONNECT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), CONNECT_RETRY_MAX_DELAY_MS));
			}
		}
	}

	/**
	 * Promisifies a single connect on the given connection, choosing connectAsync for authenticators
	 * that perform an async token exchange or browser round-trip and connect otherwise.
	 */
	private _connectOnce(conn: ISnowflakeSdkConnection): Promise<void> {
		// Compare case-insensitively: authenticators sourced from connections.toml can be lower-case
		// (e.g. `externalbrowser`), while the form-based mechanisms pass the upper-case SDK constants.
		const useAsync = this._config.authenticator !== undefined && ASYNC_AUTHENTICATORS.has(this._config.authenticator.toUpperCase());
		return new Promise<void>((resolve, reject) => {
			const callback = (err: SnowflakeError | undefined) => err ? reject(err) : resolve();
			if (useAsync) {
				// connectAsync (OAuth exchange, browser SSO) can report failure by rejecting its promise
				// without ever calling the callback, which would leave this hanging until the SDK's
				// internal timeout. Settle on whichever of the promise or the callback fires first; a
				// Promise ignores settles after the first, so wiring both is safe.
				conn.connectAsync(callback).then(() => resolve(), reject);
			} else {
				conn.connect(callback);
			}
		});
	}

	/** Establishes the connection. Must be called before query(). */
	async connect(): Promise<void> {
		await this._open();
	}

	/**
	 * Runs a query, reconnecting once and retrying if the session was found dead. A non-connection
	 * error (bad SQL, missing object) is thrown without a retry. `binds` supplies positional `?`
	 * parameters.
	 */
	async query(sqlText: string, binds?: unknown[]): Promise<SnowflakeQueryResult> {
		try {
			return await this._queryOnce(sqlText, binds);
		} catch (err) {
			if (!isFatalConnectionError(err)) {
				throw err;
			}
			await this._reconnect();
			return await this._queryOnce(sqlText, binds);
		}
	}

	/** Issues a single statement against the current connection, promisifying execute(). */
	private _queryOnce(sqlText: string, binds?: unknown[]): Promise<SnowflakeQueryResult> {
		const conn = this._conn;
		if (!conn) {
			return Promise.reject(new Error('Snowflake client is closed'));
		}
		return new Promise<SnowflakeQueryResult>((resolve, reject) => {
			conn.execute({
				sqlText,
				binds,
				complete: (err, _stmt, rows) => {
					if (err) {
						reject(err);
					} else {
						resolve({ rows: rows ?? [] });
					}
				},
			});
		});
	}

	/**
	 * Rebuilds the connection after a dead-session failure. Coalesced so concurrent callers share one
	 * reconnect; the old connection is destroyed best-effort (its session has already gone, so
	 * failures to destroy it are expected and ignored).
	 */
	private _reconnect(): Promise<void> {
		if (!this._reconnecting) {
			this._reconnecting = (async () => {
				const old = this._conn;
				this._conn = null;
				if (old) {
					await this._destroy(old).catch(() => { /* already dead; nothing to clean up */ });
				}
				await this._open();
			})().finally(() => { this._reconnecting = null; });
		}
		return this._reconnecting;
	}

	/** Closes the connection. Idempotent. */
	async end(): Promise<void> {
		const conn = this._conn;
		this._conn = null;
		if (conn) {
			await this._destroy(conn).catch(() => { /* already closed or broken; nothing more to do */ });
		}
	}

	/** Promisifies destroy() on the given connection. */
	private _destroy(conn: ISnowflakeSdkConnection): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			conn.destroy(err => err ? reject(err) : resolve());
		});
	}
}
