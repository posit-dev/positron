/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A reconnecting wrapper around the pg Client, tuned for the way Redshift Serverless treats idle
// connections. Two problems motivate it:
//
//   1. Stale sockets. A connection left open across an idle period (overnight, say) has its TCP
//      socket silently dropped -- by the serverless workgroup pausing, by Redshift's idle-session
//      timeout, or by a NAT/firewall along the way -- without a clean close reaching the client. The
//      next query then blocks on a half-open socket until the OS gives up (~60s), which surfaces as a
//      hang. TCP keepalive (off by default in pg) keeps the socket alive across short gaps and lets
//      the OS notice a dead peer quickly instead of on the next query.
//
//   2. Cold recovery. When the socket really is gone, we would rather reconnect than fail. query()
//      classifies the failure; on a connection-level error it rebuilds the pg Client and retries the
//      query once, so browsing a connection that sat idle recovers transparently. (A resuming
//      serverless workgroup can take tens of seconds to accept the new connection; the reconnect
//      waits for it rather than imposing a shorter deadline of our own.)

import { Client, QueryResult } from 'pg';
import { ConnectionOptions } from 'tls';

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
 * How long the socket may sit idle before the OS sends its first TCP keepalive probe. Kept well
 * under the intervals at which serverless workgroups, idle-session timeouts, and NAT tables tend to
 * drop an idle connection, so the socket stays warm across ordinary gaps in browsing.
 */
const KEEP_ALIVE_INITIAL_DELAY_MS = 30_000;

// Connect-retry budget. A paused Redshift Serverless workgroup resumes on connect, and the first
// attempts are dropped with a transient connection error until compute is up (tens of seconds). The
// attempt count and capped exponential backoff cover roughly a 60s resume before giving up.
const CONNECT_MAX_ATTEMPTS = 8;
const CONNECT_RETRY_BASE_DELAY_MS = 1_000;
const CONNECT_RETRY_MAX_DELAY_MS = 15_000;

/** Resolves after the given number of milliseconds. */
function defaultSleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

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
 * Builds a fresh pg Client for the given config, with TCP keepalive enabled. Factored out (and made
 * overridable via the RedshiftClient constructor) so tests can supply a fake pg client without a
 * live cluster.
 */
export type PgClientFactory = (config: RedshiftFieldConfig) => Client;

/** The real factory: a keepalive-enabled pg Client. */
const defaultPgClientFactory: PgClientFactory = config => new Client({
	host: config.host,
	port: config.port,
	user: config.user,
	password: config.password,
	database: config.database,
	ssl: buildSslConfig(config),
	// Keep the socket warm across idle gaps and let the OS detect a dead peer quickly.
	keepAlive: true,
	keepAliveInitialDelayMillis: KEEP_ALIVE_INITIAL_DELAY_MS,
});

/**
 * Whether an error means the connection itself is gone (as opposed to a SQL-level error like a
 * syntax or permission problem, which reconnecting would not fix). Covers Node socket errors, the
 * PostgreSQL SQLSTATE connection-exception class (08*) and admin shutdown / crash codes, and the
 * message-only errors the pg client raises when its socket dies. Only these trigger a reconnect, so
 * a genuine query error is never retried.
 */
function isFatalConnectionError(err: unknown): boolean {
	if (!err || typeof err !== 'object') {
		return false;
	}
	const { code, message } = err as { code?: string; message?: string };
	if (code) {
		// Node socket-level errors.
		if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT' ||
			code === 'ECONNREFUSED' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH' ||
			code === 'EHOSTDOWN') {
			return true;
		}
		// PostgreSQL connection-exception class (08xxx) and admin shutdown / crash / cannot-connect-now.
		if (code.startsWith('08') || code === '57P01' || code === '57P02' || code === '57P03') {
			return true;
		}
	}
	// The pg client raises these with no SQLSTATE code when its own socket has gone away.
	const lower = (message ?? '').toLowerCase();
	return lower.includes('connection terminated') ||
		lower.includes('connection ended') ||
		lower.includes('not queryable') ||
		lower.includes('server closed the connection');
}

/**
 * A pg Client that survives an idle socket dropping out from under it. Presents the small slice of
 * the pg Client surface the rest of the driver uses -- connect(), query(), end() -- and swaps the
 * underlying pg Client transparently when a query hits a dead connection. Callers hold a stable
 * reference to this wrapper, so schema-tree nodes built against it keep working across a reconnect.
 */
export class RedshiftClient {
	// The current pg client, or null before connect() / after end().
	private _pg: Client | null = null;

	// In-flight reconnect, shared so concurrent queries that all hit the dead socket rebuild the
	// client once rather than racing to create several.
	private _reconnecting: Promise<void> | null = null;

	/**
	 * @param _config The connection configuration.
	 * @param _createPgClient Factory for the underlying pg Client. Defaults to a keepalive-enabled
	 * real client; overridden in tests to supply a fake.
	 * @param _sleep Backoff delay between connect attempts. Overridden in tests to avoid real waits.
	 */
	constructor(
		private readonly _config: RedshiftFieldConfig,
		private readonly _createPgClient: PgClientFactory = defaultPgClientFactory,
		private readonly _sleep: (ms: number) => Promise<void> = defaultSleep
	) { }

	/**
	 * Builds a pg client, attaches the idle-error guard, connects it, and adopts it. Retries a
	 * transient connection failure with backoff so a resuming serverless workgroup is waited out; a
	 * terminal error (bad auth, unknown host) or exhausting the attempts propagates.
	 */
	private async _open(): Promise<void> {
		for (let attempt = 1; ; attempt++) {
			const pg = this._createPgClient(this._config);
			// When the socket dies while no query is in flight, the pg Client emits an asynchronous
			// 'error' event. With no listener that becomes an unhandled 'error' and takes down the
			// extension host, so absorb it here; the next query() observes the broken client and
			// reconnects.
			pg.on('error', () => { /* handled lazily by query()'s reconnect path */ });
			try {
				await pg.connect();
				this._pg = pg;
				return;
			} catch (err) {
				try {
					await pg.end();
				} catch {
					// The client never connected; nothing to close.
				}
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
	 * Runs a query, reconnecting once and retrying if the connection was found dead. A non-connection
	 * error (bad SQL, permissions) is thrown without a retry.
	 */
	async query(text: string, params?: unknown[]): Promise<QueryResult> {
		try {
			return await this._queryOnce(text, params);
		} catch (err) {
			if (!isFatalConnectionError(err)) {
				throw err;
			}
			await this._reconnect();
			return await this._queryOnce(text, params);
		}
	}

	/** Issues a single query against the current pg client. */
	private _queryOnce(text: string, params?: unknown[]): Promise<QueryResult> {
		if (!this._pg) {
			throw new Error('Redshift client is closed');
		}
		return params === undefined ? this._pg.query(text) : this._pg.query(text, params);
	}

	/**
	 * Rebuilds the pg client after a dead-socket failure. Coalesced so concurrent callers share one
	 * reconnect; the old client is closed best-effort (it has already errored, so failures to end it
	 * are expected and ignored).
	 */
	private _reconnect(): Promise<void> {
		if (!this._reconnecting) {
			this._reconnecting = (async () => {
				const old = this._pg;
				this._pg = null;
				if (old) {
					try {
						await old.end();
					} catch {
						// The socket is already broken; nothing to clean up.
					}
				}
				await this._open();
			})().finally(() => { this._reconnecting = null; });
		}
		return this._reconnecting;
	}

	/** Closes the connection. Idempotent. */
	async end(): Promise<void> {
		const pg = this._pg;
		this._pg = null;
		if (pg) {
			try {
				await pg.end();
			} catch {
				// Already closed or broken; nothing more to do.
			}
		}
	}
}
