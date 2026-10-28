/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The pieces of the Databricks OAuth user-to-machine (U2M) authorization-code flow that Positron runs
// itself instead of leaving to @databricks/sql. The SDK's own flow opens the browser from the
// extension host and listens for the redirect on that host's loopback, which on Posit Workbench is a
// remote server the user's browser never reaches (posit-dev/positron#16409). Positron opens the
// browser where the user is and accepts the redirect either on a loopback listener or pasted back by
// the user; the orchestration and the UI live in databricksSignIn.ts. Nothing here imports vscode,
// so the pieces are unit-testable with Vitest.
//
// The redirect URI is fixed. Databricks registers http://localhost:8030 for its public
// `databricks-sql-connector` client and rejects any other redirect URI, so a callback through
// Workbench's port proxy is not an option. That is why the pasted-URL path exists.

import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';

/** The public OAuth client the Databricks SQL connectors sign in as. Needs no secret; uses PKCE. */
export const OAUTH_CLIENT_ID = 'databricks-sql-connector';
/** The loopback port Databricks registered for the client's redirect URI. */
export const OAUTH_REDIRECT_PORT = 8030;
/** The redirect URI exactly as Databricks registered it: no path, no trailing slash. */
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}`;
/** The scopes a SQL connection needs; `offline_access` yields the refresh token. */
const OAUTH_SCOPES = ['sql', 'offline_access'];
// The SDK re-asks for a token 5 minutes before the JWT expires; refreshing earlier than that keeps
// the SDK from re-asking on every request while it waits for a token it considers stale.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/** A minimal HTTP response: the status and the body as text. */
export interface HttpResponse {
	status: number;
	body: string;
}

/** The HTTP client the flow uses, injectable so tests need no network. */
export type HttpRequest = (url: string, init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>;

/** The real HTTP client. Uses Node's https module so the extension host's proxy support applies. */
export const defaultHttpRequest: HttpRequest = (url, init) => new Promise((resolve, reject) => {
	const request = https.request(url, { method: init.method, headers: init.headers }, response => {
		const chunks: Buffer[] = [];
		response.on('data', (chunk: Buffer) => chunks.push(chunk));
		response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
		response.on('error', reject);
	});
	request.on('error', reject);
	request.end(init.body);
});

/** The workspace's OAuth endpoints, read from its authorization-server metadata. */
export interface OAuthEndpoints {
	authorizationEndpoint: string;
	tokenEndpoint: string;
}

/**
 * Reads the workspace's OAuth endpoints from its authorization-server metadata document. Every
 * Databricks workspace, on any cloud, serves one under `/oidc/`.
 *
 * @param host The workspace hostname, without a scheme.
 */
export async function discoverEndpoints(host: string, request: HttpRequest = defaultHttpRequest): Promise<OAuthEndpoints> {
	const url = `https://${host}/oidc/.well-known/oauth-authorization-server`;
	const response = await request(url, { method: 'GET', headers: { Accept: 'application/json' } });
	if (response.status !== 200) {
		throw new Error(`OAuth discovery at ${url} failed with HTTP ${response.status}`);
	}
	let metadata: { authorization_endpoint?: unknown; token_endpoint?: unknown };
	try {
		metadata = JSON.parse(response.body);
	} catch {
		throw new Error(`OAuth discovery at ${url} returned an unreadable response`);
	}
	if (typeof metadata.authorization_endpoint !== 'string' || typeof metadata.token_endpoint !== 'string') {
		throw new Error(`OAuth discovery at ${url} returned no authorization or token endpoint`);
	}
	return { authorizationEndpoint: metadata.authorization_endpoint, tokenEndpoint: metadata.token_endpoint };
}

/** An authorization request: the URL to open, plus the secrets the callback is checked against. */
export interface AuthorizationRequest {
	/** The authorization URL to open in the browser. */
	url: string;
	/** The random state the callback must echo back. */
	state: string;
	/** The PKCE code verifier the token exchange must present. */
	verifier: string;
}

function base64url(bytes: Buffer): string {
	return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Builds the authorization URL for a PKCE authorization-code request.
 *
 * @param authorizationEndpoint The workspace's authorization endpoint.
 * @param redirectUri The redirect URI, which must be one Databricks registered for the client.
 * @param randomBytes Source of randomness for the state and verifier; injectable for tests.
 */
export function createAuthorizationRequest(
	authorizationEndpoint: string,
	redirectUri: string,
	randomBytes: (size: number) => Buffer = crypto.randomBytes
): AuthorizationRequest {
	const verifier = base64url(randomBytes(32));
	const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
	const state = base64url(randomBytes(16));
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: OAUTH_CLIENT_ID,
		redirect_uri: redirectUri,
		scope: OAUTH_SCOPES.join(' '),
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
	}).toString();
	const separator = authorizationEndpoint.includes('?') ? '&' : '?';
	return { url: `${authorizationEndpoint}${separator}${query}`, state, verifier };
}

/** What a redirect carried: an authorization code, or an error from the authorization server. */
export type CallbackResult =
	| { code: string; error?: undefined; description?: undefined }
	| { code?: undefined; error: string; description?: string };

/**
 * Reads the authorization code (or error) out of a redirect URL. Accepts the URL as the browser
 * shows it, with or without a scheme, so a pasted address bar works.
 *
 * @returns undefined when the URL is not a sign-in callback at all (no state, code, or error);
 * `{ error: 'state_mismatch' }` when it is a callback from a different sign-in attempt.
 */
export function parseCallbackUrl(input: string, expectedState: string): CallbackResult | undefined {
	const trimmed = input.trim();
	let url: URL;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
	} catch {
		return undefined;
	}
	const params = url.searchParams;
	if (!params.has('state') && !params.has('code') && !params.has('error')) {
		return undefined;
	}
	if (params.get('state') !== expectedState) {
		return { error: 'state_mismatch' };
	}
	const error = params.get('error');
	if (error) {
		return { error, description: params.get('error_description') ?? undefined };
	}
	const code = params.get('code');
	if (!code) {
		return { error: 'missing_code' };
	}
	return { code };
}

/** The tokens a successful token request yields. */
export interface OAuthTokens {
	accessToken: string;
	/** Absent when the server issued none; the session then cannot outlive the access token. */
	refreshToken?: string;
	/** When the access token expires, as epoch milliseconds. Absent when the server did not say. */
	expiresAt?: number;
}

/** The `exp` claim of a JWT access token as epoch milliseconds, or undefined if it has none. */
export function jwtExpiry(token: string): number | undefined {
	const payload = token.split('.')[1];
	if (!payload) {
		return undefined;
	}
	try {
		const { exp } = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
		return typeof exp === 'number' ? exp * 1000 : undefined;
	} catch {
		return undefined;
	}
}

async function requestTokens(
	tokenEndpoint: string,
	params: Record<string, string>,
	request: HttpRequest,
	now: () => number
): Promise<OAuthTokens> {
	const body = new URLSearchParams({ client_id: OAUTH_CLIENT_ID, ...params }).toString();
	const response = await request(tokenEndpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
		body,
	});
	let payload: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown } = {};
	try {
		payload = JSON.parse(response.body);
	} catch {
		// A non-JSON body is reported through the status below.
	}
	if (response.status !== 200 || typeof payload.access_token !== 'string') {
		const detail = typeof payload.error_description === 'string' ? payload.error_description
			: typeof payload.error === 'string' ? payload.error
				: `HTTP ${response.status}`;
		throw new Error(`Databricks token request failed: ${detail}`);
	}
	return {
		accessToken: payload.access_token,
		refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
		expiresAt: typeof payload.expires_in === 'number' ? now() + payload.expires_in * 1000 : jwtExpiry(payload.access_token),
	};
}

/**
 * Exchanges an authorization code for tokens.
 *
 * @param redirectUri The redirect URI the authorization request used; the server checks they match.
 */
export function exchangeAuthorizationCode(
	tokenEndpoint: string,
	grant: { code: string; verifier: string; redirectUri: string },
	request: HttpRequest = defaultHttpRequest,
	now: () => number = Date.now
): Promise<OAuthTokens> {
	return requestTokens(tokenEndpoint, {
		grant_type: 'authorization_code',
		code: grant.code,
		code_verifier: grant.verifier,
		redirect_uri: grant.redirectUri,
	}, request, now);
}

/** Trades a refresh token for a new access token (and, usually, a new refresh token). */
export function refreshAccessToken(
	tokenEndpoint: string,
	refreshToken: string,
	request: HttpRequest = defaultHttpRequest,
	now: () => number = Date.now
): Promise<OAuthTokens> {
	return requestTokens(tokenEndpoint, { grant_type: 'refresh_token', refresh_token: refreshToken }, request, now);
}

/**
 * A signed-in session: holds the tokens and hands out a current access token, refreshing it ahead
 * of expiry. One session backs a connection for its whole life, including reconnects, so the user
 * signs in once.
 */
export class DatabricksOAuthSession {
	private _tokens: OAuthTokens;
	// In-flight refresh, shared so concurrent callers do not each spend the refresh token.
	private _refreshing: Promise<string> | null = null;

	constructor(
		private readonly _tokenEndpoint: string,
		tokens: OAuthTokens,
		private readonly _request: HttpRequest = defaultHttpRequest,
		private readonly _now: () => number = Date.now
	) {
		this._tokens = tokens;
	}

	/** The current access token, refreshed first if it is about to expire. */
	async getAccessToken(): Promise<string> {
		const { accessToken, refreshToken, expiresAt } = this._tokens;
		const expiring = expiresAt !== undefined && expiresAt - this._now() <= REFRESH_MARGIN_MS;
		if (!expiring) {
			return accessToken;
		}
		if (!refreshToken) {
			throw new Error('The Databricks access token has expired and there is no refresh token to renew it');
		}
		if (!this._refreshing) {
			this._refreshing = refreshAccessToken(this._tokenEndpoint, refreshToken, this._request, this._now)
				.then(tokens => {
					// A server that rotates refresh tokens sends a new one; one that does not expects
					// the old one to be reused.
					this._tokens = { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
					return tokens.accessToken;
				})
				.finally(() => { this._refreshing = null; });
		}
		return this._refreshing;
	}
}

/** A loopback listener awaiting the redirect. */
export interface CallbackListener {
	/** The port the listener is bound to. */
	readonly port: number;
	/** Settles with the redirect's contents. Never settles if the listener is closed first. */
	readonly result: Promise<CallbackResult>;
	/** Stops listening and drops any connections, freeing the port for the next sign-in. */
	close(): void;
}

/**
 * Listens on the loopback port for the redirect. Requests that are not a callback for `state`
 * (a favicon probe, a stale redirect from another attempt) get a 404 and are ignored.
 *
 * @param responseHtml The page shown in the browser tab once the redirect has been received.
 * @returns Rejects if the port cannot be bound (e.g. another sign-in on the same host holds it).
 */
export function listenForCallback(port: number, state: string, responseHtml: string): Promise<CallbackListener> {
	return new Promise((resolve, reject) => {
		let settle: (result: CallbackResult) => void;
		const result = new Promise<CallbackResult>(r => { settle = r; });
		const server = http.createServer((req, res) => {
			const parsed = parseCallbackUrl(`http://127.0.0.1${req.url ?? '/'}`, state);
			if (!parsed || parsed.error === 'state_mismatch') {
				res.writeHead(404);
				res.end();
				return;
			}
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
			res.end(responseHtml);
			settle(parsed);
		});
		server.on('error', reject);
		// Bind the IPv4 loopback explicitly: `localhost` may bind only IPv6 on some hosts, and the
		// browser tries both addresses for the registered `localhost` redirect.
		server.listen(port, '127.0.0.1', () => resolve({
			port: (server.address() as { port: number }).port,
			result,
			close: () => {
				server.close();
				// close() alone leaves keep-alive connections, and so the port, open for minutes.
				(server as { closeAllConnections?: () => void }).closeAllConnections?.();
			},
		}));
	});
}
