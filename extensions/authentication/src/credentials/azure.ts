/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Fetches delegated Azure access tokens from Posit Workbench. Unlike Snowflake and Databricks, Workbench
// provisions no file for Azure: the session asks the Workbench server for a token for one Azure
// resource at a time, authenticating with the session's RPC cookie. The protocol matches the two
// reference clients, the posit-sdk (`posit.workbench.oauth`) and rstudioapi >= 0.18.0
// (`getDelegatedAzureToken`).
//
// This module imports nothing from `vscode`, so it can be unit tested under Vitest. The caller maps
// `AzureTokenError.code` to a localized message.

import * as fs from 'fs';
import * as path from 'path';

/** The Workbench RPC method, also the endpoint path, that exchanges for a delegated Azure token. */
const DELEGATED_AZURE_TOKEN_METHOD = 'delegated_azure_token';

/** The header that carries the session's RPC cookie. */
const RPC_COOKIE_HEADER = 'X-RS-Session-Server-RPC-Cookie';

/** The oldest Workbench release that serves delegated Azure tokens. */
const MINIMUM_WORKBENCH_VERSION: readonly number[] = [2024, 12, 0];

/** How long to wait for Workbench to answer before giving up. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Why a delegated Azure token could not be obtained. Each maps to one thing the user can do. */
export type AzureTokenErrorCode =
	/** Not in a Workbench session that can serve delegated tokens (no server address). */
	| 'unavailable'
	/** Workbench is older than 2024.12.0. */
	| 'workbench-too-old'
	/** The session's RPC cookie is missing, e.g. a `/tmp` cleaner deleted the runtime directory. */
	| 'no-rpc-cookie'
	/** The Workbench server could not be reached, or did not answer in time. */
	| 'unreachable'
	/** The Workbench app registration lacks the delegated permission, or admin consent for it. */
	| 'consent-required'
	/** The user's Entra ID refresh token has expired or been revoked. */
	| 'reauthenticate'
	/** Workbench has no refresh token for the user: it does not sign in with Entra ID, or lacks `offline_access`. */
	| 'entra-not-configured'
	/** Anything else. The message carries Workbench's own description. */
	| 'unknown';

/**
 * A failure to obtain a delegated Azure token. The message is a diagnostic in English for the log;
 * it never contains the token or the RPC cookie.
 */
export class AzureTokenError extends Error {
	constructor(readonly code: AzureTokenErrorCode, message: string) {
		super(message);
		this.name = 'AzureTokenError';
	}
}

/** A delegated Azure access token for one resource. */
export interface DelegatedAzureToken {
	/** The bearer token. */
	readonly accessToken: string;
	/** When the token expires, in milliseconds since the epoch. */
	readonly expiresAt: number;
}

/** The parts of a `fetch` response the client reads. */
export interface AzureTokenResponse {
	readonly status: number;
	text(): Promise<string>;
}

/** Sends one request to Workbench. Injectable so tests need no server. */
export type AzureTokenTransport = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<AzureTokenResponse>;

/** What the client reads from its surroundings. Every member is injectable for tests. */
export interface AzureTokenClientOptions {
	/** How long before expiry a cached token is replaced. */
	readonly refreshBufferMs: number;
	/** The environment to read; the process environment by default. */
	readonly env?: NodeJS.ProcessEnv;
	/** Sends the request; global `fetch` by default. */
	readonly transport?: AzureTokenTransport;
	/** Reads a file as UTF-8, or undefined when it does not exist. */
	readonly readFile?: (filePath: string) => Promise<string | undefined>;
	/** The current time in milliseconds since the epoch. */
	readonly now?: () => number;
	/** Receives diagnostics. Never passed a token or cookie. */
	readonly log?: (message: string) => void;
}

/**
 * Whether the environment looks like a Workbench session that can serve delegated Azure tokens: it
 * names the Workbench server and gives the session an RPC cookie (a runtime directory holding one,
 * or the cookie itself). This cannot tell whether Workbench signs in with Entra ID; only a request can.
 */
export function isDelegatedAzureTokenAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
	return !!env.RS_SERVER_ADDRESS && (!!env.PWB_SESSION_RUNTIME_DIR || !!env.RS_SESSION_RPC_COOKIE);
}

/**
 * Whether `RSTUDIO_VERSION` is at least 2024.12.0. Values look like `2024.12.0+467.pro1`, so everything
 * from the first `-` or `+` is dropped before comparing. A missing or `dev` version passes, as in
 * both reference clients.
 */
export function isSupportedWorkbenchVersion(version: string | undefined): boolean {
	const trimmed = version?.trim();
	if (!trimmed || trimmed.includes('dev')) {
		return true;
	}
	const parts = trimmed.split(/[-+]/)[0].split('.').map(part => Number.parseInt(part, 10));
	if (parts.some(part => Number.isNaN(part))) {
		return true;
	}
	for (let i = 0; i < MINIMUM_WORKBENCH_VERSION.length; i++) {
		const part = parts[i] ?? 0;
		if (part !== MINIMUM_WORKBENCH_VERSION[i]) {
			return part > MINIMUM_WORKBENCH_VERSION[i];
		}
	}
	return true;
}

/**
 * The expiry of an RPC cookie, in milliseconds since the epoch: its second `|`-separated field is an
 * HTTP date. Undefined when the cookie carries none that parses.
 */
export function parseRpcCookieExpiry(cookie: string): number | undefined {
	const field = cookie.split('|')[1];
	const expiresAt = field ? Date.parse(field) : NaN;
	return Number.isNaN(expiresAt) ? undefined : expiresAt;
}

/** Reads a UTF-8 file, or undefined when it does not exist or cannot be read. */
async function readFileIfPresent(filePath: string): Promise<string | undefined> {
	try {
		return await fs.promises.readFile(filePath, 'utf8');
	} catch {
		return undefined;
	}
}

/** Sends the request with the extension host's global `fetch`. */
const fetchTransport: AzureTokenTransport = (url, init) => fetch(url, init);

/** Classifies a description Workbench or Entra ID returned for a failed exchange. */
function classifyFailure(description: string, status?: number): AzureTokenErrorCode {
	// AADSTS65001: the user or administrator has not consented to the application's permission.
	if (/AADSTS65001|consent/i.test(description) || status === 403) {
		return 'consent-required';
	}
	// AADSTS700082 / AADSTS70043: the refresh token expired. AADSTS50173 / AADSTS50078: revoked or
	// needs fresh credentials. `invalid_grant` is the OAuth error code Entra ID uses for all of them.
	if (/AADSTS(700082|70043|50173|50078)|invalid_grant|expired/i.test(description)) {
		return 'reauthenticate';
	}
	// Workbench refuses outright when it holds no refresh token for the user: it does not use Entra ID,
	// or `offline_access` is missing from its scopes.
	if (/refresh[ _]token|openid|offline_access/i.test(description)) {
		return 'entra-not-configured';
	}
	return 'unknown';
}

/** Turns any JSON value into a one-line description for a diagnostic. */
function describe(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const parts = [record.error, record.message, record.error_description, record.description]
			.filter((part): part is string => typeof part === 'string' && part.length > 0);
		if (parts.length > 0) {
			return parts.join(': ');
		}
	}
	return JSON.stringify(value) ?? String(value);
}

/**
 * Parses Workbench's answer into a token, or throws an `AzureTokenError` for each failure shape both
 * reference clients handle.
 */
export function parseDelegatedTokenResponse(status: number, body: string, now: number): DelegatedAzureToken {
	let json: Record<string, unknown> | undefined;
	try {
		const parsed: unknown = JSON.parse(body);
		json = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
	} catch {
		json = undefined;
	}

	const fail = (description: string): never => {
		throw new AzureTokenError(classifyFailure(description, status >= 400 ? status : undefined), `Workbench refused the delegated Azure token request (HTTP ${status}): ${description}`);
	};

	if (json?.oauth2_error !== undefined) {
		return fail(describe(json.oauth2_error));
	}
	if (json?.error !== undefined && json.error !== null) {
		return fail(describe(json.error));
	}
	if (json?.result === false) {
		return fail(describe(json.detail ?? 'no detail'));
	}
	if (status >= 400) {
		return fail(body.trim().slice(0, 500) || 'no response body');
	}

	const token = json?.token as Record<string, unknown> | undefined;
	const accessToken = token?.access_token;
	if (typeof accessToken !== 'string' || accessToken.length === 0) {
		throw new AzureTokenError('unknown', `Workbench answered the delegated Azure token request without a token (HTTP ${status}).`);
	}
	// Without an expiry the token is not cached; every request exchanges again.
	const expiresIn = Number(token?.expires_in);
	return { accessToken, expiresAt: Number.isFinite(expiresIn) ? now + expiresIn * 1000 : now };
}

/**
 * Fetches delegated Azure tokens from Posit Workbench, caching each in memory until shortly before it
 * expires. Every Workbench call exchanges the user's refresh token with Entra ID, which may throttle
 * repeated exchanges, so callers can ask for a token on every connect and let this cache absorb it.
 * Tokens are never written to disk or logged.
 */
export class DelegatedAzureTokenClient {
	private readonly _env: NodeJS.ProcessEnv;
	private readonly _transport: AzureTokenTransport;
	private readonly _readFile: (filePath: string) => Promise<string | undefined>;
	private readonly _now: () => number;
	private readonly _log: (message: string) => void;

	/** The RPC cookie last read, until its own expiry. */
	private _cookie: { value: string; expiresAt: number } | undefined;

	/** Tokens by resource, including requests still in flight, so concurrent connects share one exchange. */
	private readonly _tokens = new Map<string, Promise<DelegatedAzureToken>>();

	constructor(private readonly _options: AzureTokenClientOptions) {
		this._env = _options.env ?? process.env;
		this._transport = _options.transport ?? fetchTransport;
		this._readFile = _options.readFile ?? readFileIfPresent;
		this._now = _options.now ?? Date.now;
		this._log = _options.log ?? (() => { });
	}

	/**
	 * A delegated access token for the given Azure resource (e.g. `https://ossrdbms-aad.database.windows.net`),
	 * from the cache while it has more than the refresh buffer left. Throws an `AzureTokenError`.
	 */
	async getToken(resource: string): Promise<DelegatedAzureToken> {
		// A failed exchange removes itself from the map (below), so an entry here is either a token or
		// an exchange in flight. A caller that joins one in flight shares its failure rather than
		// starting a second exchange.
		const cached = this._tokens.get(resource);
		if (cached) {
			const token = await cached;
			if (token.expiresAt - this._now() > this._options.refreshBufferMs) {
				return token;
			}
			// Expired. Drop the entry unless another caller already replaced it, and join theirs if so.
			if (this._tokens.get(resource) === cached) {
				this._tokens.delete(resource);
			}
			const replacement = this._tokens.get(resource);
			if (replacement) {
				return replacement;
			}
		}

		const request = this._exchange(resource);
		this._tokens.set(resource, request);
		request.catch(() => {
			if (this._tokens.get(resource) === request) {
				this._tokens.delete(resource);
			}
		});
		return request;
	}

	/** Asks Workbench for a token, retrying once with a freshly read cookie if Workbench rejects the cookie. */
	private async _exchange(resource: string): Promise<DelegatedAzureToken> {
		const serverAddress = this._env.RS_SERVER_ADDRESS?.trim();
		if (!serverAddress) {
			throw new AzureTokenError('unavailable', 'RS_SERVER_ADDRESS is not set; this is not a Posit Workbench session.');
		}
		if (!isSupportedWorkbenchVersion(this._env.RSTUDIO_VERSION)) {
			throw new AzureTokenError('workbench-too-old', `Delegated Azure credentials need Posit Workbench 2024.12.0 or later; this is ${this._env.RSTUDIO_VERSION}.`);
		}

		const url = `${serverAddress.replace(/\/+$/, '')}/${DELEGATED_AZURE_TOKEN_METHOD}`;
		let response = await this._send(url, resource, await this._readCookie(false));
		if (response.status === 401) {
			// The cookie may have rotated since it was cached.
			this._log('Workbench rejected the RPC cookie; reading it again and retrying.');
			response = await this._send(url, resource, await this._readCookie(true));
		}
		const token = parseDelegatedTokenResponse(response.status, await response.text(), this._now());
		this._log(`Obtained a delegated Azure token for ${resource}, valid for ${Math.round((token.expiresAt - this._now()) / 1000)}s.`);
		return token;
	}

	/** Posts one exchange request. */
	private async _send(url: string, resource: string, cookie: string): Promise<AzureTokenResponse> {
		try {
			return await this._transport(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					[RPC_COOKIE_HEADER]: cookie,
				},
				body: JSON.stringify({ method: DELEGATED_AZURE_TOKEN_METHOD, params: [resource] }),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			// fetch reports network failures as "fetch failed" with the reason in `cause`.
			const reason = (error as { cause?: unknown } | undefined)?.cause;
			const cause = reason instanceof Error ? ` (${reason.message})` : '';
			throw new AzureTokenError('unreachable', `Could not reach Posit Workbench at ${url}: ${error instanceof Error ? error.message : String(error)}${cause}`);
		}
	}

	/**
	 * The session's RPC cookie. The runtime directory's `rpc_cookie` file comes first, as in the
	 * posit-sdk: Workbench keeps it current, while `RS_SESSION_RPC_COOKIE` is fixed at session launch.
	 * The cookie is reused until its own expiry unless `force` is set.
	 */
	private async _readCookie(force: boolean): Promise<string> {
		if (!force && this._cookie && this._cookie.expiresAt > this._now()) {
			return this._cookie.value;
		}
		this._cookie = undefined;

		const runtimeDir = this._env.PWB_SESSION_RUNTIME_DIR?.trim();
		const fromFile = runtimeDir ? (await this._readFile(path.join(runtimeDir, 'rpc_cookie')))?.trim() : undefined;
		const value = fromFile || this._env.RS_SESSION_RPC_COOKIE?.trim();
		if (!value) {
			throw new AzureTokenError('no-rpc-cookie', runtimeDir
				? `No Workbench RPC cookie in ${runtimeDir}/rpc_cookie or RS_SESSION_RPC_COOKIE.`
				: 'No Workbench RPC cookie: PWB_SESSION_RUNTIME_DIR and RS_SESSION_RPC_COOKIE are unset.');
		}

		// A cookie without a readable expiry is used once and read again next time.
		const expiresAt = parseRpcCookieExpiry(value);
		if (expiresAt !== undefined) {
			this._cookie = { value, expiresAt };
		}
		return value;
	}
}
